const fs = require('fs');

const appPath = 'src/App.jsx';
let lines = fs.readFileSync(appPath, 'utf8').split('\n');

const presetUrls = [
  { url: 'https://trustpositif.komdigi.go.id/assets/db/domains', name: 'Komdigi TrustPositif', desc: 'Situs terlarang Indonesia (Judi, Porno, Radikal)' },
  { url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts', name: 'Ads & Telemetry', desc: 'Pemblokir Iklan, Pelacak, dan Spam Global' },
  { url: 'https://big.oisd.nl/', name: 'Malware & Phishing', desc: 'Ransomware, Botnet, penipuan' },
  { url: 'https://nsfw.oisd.nl/', name: 'Adult Content (NSFW)', desc: 'Blokir situs dewasa' }
];

const newHtml = `
              <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden lg:col-span-2">
                <div className="p-6 border-b border-slate-800">
                  <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                    <ShieldAlert className="w-5 h-5 text-indigo-400" />
                    Bahan Baku DNS (Threat Feeds)
                  </h2>
                  <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                    Pilih profil keamanan otomatis (Toggles). Data akan dimuat dari repositori komunitas global.
                  </p>
                </div>
                
                <div className="p-6 bg-slate-950/50 flex flex-col flex-1 gap-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      { url: 'https://trustpositif.komdigi.go.id/assets/db/domains', name: 'Komdigi TrustPositif', desc: 'Situs terlarang Pemerintah (Judi, dsb)' },
                      { url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts', name: 'Ads & Trackers', desc: 'Pemblokir Iklan dan Pelacak' },
                      { url: 'https://big.oisd.nl/', name: 'Malware & Phishing', desc: 'Ransomware, Botnet, Penipuan' },
                      { url: 'https://nsfw.oisd.nl/domainswild', name: 'Adult Content (NSFW)', desc: 'Blokir situs dewasa / pornografi' }
                    ].map(preset => {
                      const feedObj = rpzFeeds.find(f => f.url === preset.url);
                      const isEnabled = feedObj ? feedObj.enabled : false;
                      const syncData = stats?.rpz_status?.find(s => s.url === preset.url);
                      const isError = syncData && syncData.status !== "Synced & Parsed" && syncData.status !== "Disabled" && syncData.status !== "Mock";
                      
                      return (
                        <div key={preset.url} className="bg-[#0b1120] border border-slate-800 p-4 rounded-xl flex flex-col justify-between shadow-inner transition-colors hover:border-indigo-500/30">
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <h3 className="font-semibold text-slate-200 text-sm">{preset.name}</h3>
                              <p className="text-xs text-slate-500 mt-1">{preset.desc}</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input type="checkbox" className="sr-only peer" checked={isEnabled} onChange={(e) => {
                                const checked = e.target.checked;
                                let next = [...rpzFeeds];
                                const existIdx = next.findIndex(f => f.url === preset.url);
                                if (existIdx >= 0) {
                                  next[existIdx].enabled = checked;
                                } else {
                                  next.push({ url: preset.url, enabled: checked });
                                }
                                setRpzFeeds(next);
                              }} />
                              <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500 shadow-inner"></div>
                            </label>
                          </div>
                          {syncData && isEnabled && (
                            <div className="mt-2 text-[10px] font-mono">
                              {isError ? (
                                <span className="text-red-400 bg-red-400/10 px-2 py-1 rounded inline-block truncate max-w-full">Error: {syncData.error || syncData.status}</span>
                              ) : syncData.status === "Synced & Parsed" ? (
                                <span className="text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded w-max inline-block"><CheckCircle2 className="w-3 h-3 inline mr-1" />{syncData.records.toLocaleString()} Baris Aktif</span>
                              ) : (
                                <span className="text-slate-400 bg-slate-800 px-2 py-1 rounded w-max inline-block animate-pulse">{syncData.status}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Custom URLs */}
                  <div className="mt-4 border-t border-slate-800/80 pt-4">
                    <h3 className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wider">Feed URL Kustom</h3>
                    <div className="space-y-2">
                       {rpzFeeds.filter(f => ![
                          'https://trustpositif.komdigi.go.id/assets/db/domains',
                          'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
                          'https://big.oisd.nl/',
                          'https://nsfw.oisd.nl/domainswild'
                       ].includes(f.url)).map((feed, i) => (
                           <div key={"custom"+i} className="flex gap-2">
                             <input type="text" value={feed.url} onChange={e => {
                                const next = [...rpzFeeds];
                                const trueIdx = next.findIndex(x => x === feed);
                                next[trueIdx].url = e.target.value;
                                setRpzFeeds(next);
                             }} className="flex-1 bg-[#0b1120] text-xs font-mono text-slate-300 border border-slate-800 rounded px-3 py-1.5 focus:border-indigo-500 focus:outline-none" placeholder="https://..." />
                             <button onClick={() => {
                                const next = [...rpzFeeds];
                                const trueIdx = next.findIndex(x => x === feed);
                                next[trueIdx].enabled = !next[trueIdx].enabled;
                                setRpzFeeds(next);
                             }} className={\`px-3 py-1.5 rounded text-[10px] font-bold \${feed.enabled ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'}\`}>{feed.enabled ? 'ON' : 'OFF'}</button>
                             <button onClick={() => {
                                const next = [...rpzFeeds];
                                const trueIdx = next.findIndex(x => x === feed);
                                next.splice(trueIdx, 1);
                                setRpzFeeds(next);
                             }} className="px-3 py-1.5 bg-red-500/10 text-red-500 rounded hover:bg-red-500/20 text-xs">✕</button>
                           </div>
                       ))}
                       <button onClick={() => setRpzFeeds([...rpzFeeds, {url: '', enabled: true}])} className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300">+ Tambah Feed Eksternal Baru</button>
                    </div>
                  </div>

                  <div className="mt-auto pt-4 border-t border-slate-800 flex items-center justify-between">
                     <span className="text-xs text-slate-400 font-bold tracking-widest uppercase">Cron Interval</span>
                     <div className="flex items-center gap-2">
                        <input 
                           type="number" 
                           value={syncInterval} 
                           onChange={e => setSyncInterval(parseInt(e.target.value) || 1)}
                           className="w-16 bg-[#0b1120] border border-slate-700/50 rounded px-2 py-1 text-center text-sm font-mono text-indigo-300 focus:outline-none focus:border-indigo-500/50"
                           min="1"
                        />
                        <span className="text-[10px] text-slate-500 font-bold">MENIT</span>
                     </div>
                  </div>
                </div>
                <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end">
                  <button onClick={saveRPZ} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg shadow-[0_0_15px_rgba(79,70,229,0.2)] transition-colors duration-200 flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" /> Simpan Konfigurasi & Tarik Data
                  </button>
                </div>
              </div>
`;

// lines 720 to 818 (0-indexed are 719-817)
lines.splice(720, 98, newHtml);

fs.writeFileSync(appPath, lines.join('\n'));
console.log('RPZ Feeds UI Refactored!');
