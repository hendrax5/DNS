#include <lua.h>
#include <lauxlib.h>
#include <stdint.h>
#include <string.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#include <stdio.h>

#define BLOOM_SIZE 33554432 // 32MB

static uint8_t *bloom_ptr = NULL;
static int bloom_fd = -1;

// Natively optimized FNV1a 64-bit domain hash mirroring Golang strings.Split(".")
static uint64_t hash_domain(const char *domain, size_t len) {
    uint64_t hash = 0xCBF29CE484222325ULL;
    uint64_t prime = 0x100000001B3ULL;

    size_t s = 0;
    while (s < len) {
        size_t e = s;
        while (e < len && domain[e] != '.') {
            e++;
        }

        size_t part_len = e - s;
        if (part_len > 0) {
            hash ^= part_len;
            hash *= prime;
            for (size_t i = s; i < e; i++) {
                uint8_t byte = (uint8_t)domain[i];
                // Match case-insensitivity mapping
                if (byte >= 'A' && byte <= 'Z') {
                    byte += 32;
                }
                hash ^= byte;
                hash *= prime;
            }
        }
        s = e + 1;
    }
    return hash;
}

static int check_bloom(lua_State *L) {
    size_t len;
    const char *domain = luaL_checklstring(L, 1, &len);

    if (!bloom_ptr || bloom_ptr == MAP_FAILED) {
        lua_pushboolean(L, 0);
        return 1;
    }

    if (len > 0 && domain[len - 1] == '.') {
        len--; // remove trailing dot
    }

    uint64_t h1 = hash_domain(domain, len);
    
    char combined[512] = "salt_b";
    if (len + 6 < 512) {
        memcpy(combined + 6, domain, len);
        uint64_t h2 = hash_domain(combined, len + 6);
        
        uint64_t mBits = 268435456; // 32MB * 8
        int k = 9;
        
        for (int i=0; i<k; i++) {
            uint64_t idx = (h1 + i * h2) % mBits;
            uint32_t byte_index = idx / 8;
            uint8_t bit_mask = 1 << (idx % 8);
            
            if ((bloom_ptr[byte_index] & bit_mask) == 0) {
                lua_pushboolean(L, 0);
                return 1;
            }
        }
        lua_pushboolean(L, 1);
        return 1;
    }
    
    lua_pushboolean(L, 0);
    return 1;
}

static int reload_bloom(lua_State *L) {
    if (bloom_fd != -1) {
        if (bloom_ptr && bloom_ptr != MAP_FAILED) {
            munmap(bloom_ptr, BLOOM_SIZE);
        }
        close(bloom_fd);
        bloom_ptr = NULL;
        bloom_fd = -1;
    }

    bloom_fd = open("/etc/powerdns/bloom.bin", O_RDONLY);
    if (bloom_fd >= 0) {
        bloom_ptr = mmap(NULL, BLOOM_SIZE, PROT_READ, MAP_SHARED, bloom_fd, 0);
        if (bloom_ptr == MAP_FAILED) {
            bloom_ptr = NULL;
            close(bloom_fd);
            bloom_fd = -1;
            if (L) {
                lua_pushboolean(L, 0);
                return 1;
            }
        }
    }
    
    if (L) {
        lua_pushboolean(L, bloom_ptr != NULL);
        return 1;
    }
    return 0;
}

static const struct luaL_Reg bloom_funcs[] = {
    {"check", check_bloom},
    {"reload", reload_bloom},
    {NULL, NULL}
};

int luaopen_bloom_native(lua_State *L) {
    // Attempt graceful initial map
    reload_bloom(NULL);
    
    luaL_newlib(L, bloom_funcs);
    return 1;
}
