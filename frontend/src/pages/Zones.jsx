import { useState, useEffect } from 'react';
import { Database, Plus, Trash2, Server, Globe } from 'lucide-react';

export default function Zones({ apiFetch, setSaveStatus }) {
  const [zones, setZones] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newZoneDomain, setNewZoneDomain] = useState('');
  
  // Modals/Forms State
  const [activeZoneId, setActiveZoneId] = useState(null);
  const [newRecord, setNewRecord] = useState({ type: 'A', name: '', content: '', ttl: 3600 });

  useEffect(() => {
    fetchZones();
  }, []);

  const fetchZones = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/zones');
      if (res.ok) {
        const data = await res.json();
        setZones(data || []);
      }
    } catch (e) {
      console.error(e);
    }
    setIsLoading(false);
  };

  const handleAddZone = async (e) => {
    e.preventDefault();
    if (!newZoneDomain) return;
    try {
      const res = await apiFetch('/api/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: newZoneDomain })
      });
      if (res.ok) {
        setSaveStatus({ show: true, message: 'Zone berhasil ditambah. Reloading DNS...', type: 'success' });
        setNewZoneDomain('');
        fetchZones();
      } else {
        setSaveStatus({ show: true, message: 'Gagal menambah zone', type: 'error' });
      }
    } catch (err) {
      setSaveStatus({ show: true, message: 'Server terputus', type: 'error' });
    }
    setTimeout(() => setSaveStatus(s => ({ ...s, show: false })), 3000);
  };

  const handleDeleteZone = async (id) => {
    try {
      const res = await apiFetch(`/api/zones/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSaveStatus({ show: true, message: 'Zone dihapus', type: 'success' });
        fetchZones();
      }
    } catch (err) { }
    setTimeout(() => setSaveStatus(s => ({ ...s, show: false })), 3000);
  };

  const handleAddRecord = async (e, zoneId) => {
    e.preventDefault();
    if (!newRecord.content) return;
    try {
      const payload = { ...newRecord, zone_id: zoneId };
      const res = await apiFetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setSaveStatus({ show: true, message: 'DNS Record sukses ditambah', type: 'success' });
        setNewRecord({ type: 'A', name: '', content: '', ttl: 3600 });
        fetchZones();
      }
    } catch (err) { }
    setTimeout(() => setSaveStatus(s => ({ ...s, show: false })), 3000);
  };

  const handleDeleteRecord = async (id) => {
    try {
      const res = await apiFetch(`/api/records/${id}`, { method: 'DELETE' });
      if (res.ok) fetchZones();
    } catch (err) { }
  };

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
          <Globe className="w-6 h-6 text-emerald-400" />
          Authoritative Zones (Local DNS)
        </h1>
        <p className="text-slate-400 text-sm mt-1">Hosting nama domain privat atau ubah arah public domain sesuai keinginan (sekelas Technitium). Engine akan otomatis menulis Ulang Bind Zone dan merestart Backend.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
        <div className="p-6 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
            <Database className="w-5 h-5 text-indigo-400" />
            Manajemen Zona
          </h2>
          <form onSubmit={handleAddZone} className="flex gap-2">
            <input 
              type="text" 
              value={newZoneDomain}
              onChange={e => setNewZoneDomain(e.target.value)}
              placeholder="misal: kantor.local" 
              className="bg-[#0b1120] border border-slate-700/50 rounded-lg px-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              required
            />
            <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Buat Zona
            </button>
          </form>
        </div>

        <div className="p-6 bg-slate-950/50 flex flex-col gap-6">
          {isLoading ? (
            <div className="text-center text-slate-500 py-10">Memuat infrastruktur zona...</div>
          ) : zones.length === 0 ? (
            <div className="text-center text-slate-500 py-10">Belum ada domain lokal yang di-host. Buat zona pertama Anda di atas.</div>
          ) : (
            zones.map((zone) => (
              <div key={zone.id} className="border border-slate-800 rounded-xl bg-slate-900/50 overflow-hidden">
                <div className="bg-slate-800/40 p-4 border-b border-slate-800 flex justify-between items-center cursor-pointer" onClick={() => setActiveZoneId(activeZoneId === zone.id ? null : zone.id)}>
                  <div className="flex items-center gap-3">
                    <Server className="w-5 h-5 text-fuchsia-400" />
                    <span className="font-bold text-lg text-slate-200">{zone.domain}</span>
                    <span className="text-xs font-mono bg-slate-800 px-2 rounded-md text-slate-400">{zone.records ? zone.records.length : 0} Records</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteZone(zone.id); }} className="text-slate-500 hover:text-red-400">
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                {activeZoneId === zone.id && (
                  <div className="p-4 bg-slate-950">
                    <table className="w-full text-left text-sm text-slate-400 mb-4">
                      <thead className="bg-[#0b1120] text-xs font-semibold uppercase text-slate-500 border-b border-slate-800">
                        <tr>
                          <th className="px-4 py-2">Name</th>
                          <th className="px-4 py-2">Type</th>
                          <th className="px-4 py-2">TTL</th>
                          <th className="px-4 py-2">Content (Target)</th>
                          <th className="px-4 py-2 w-10">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {zone.records && zone.records.map(record => (
                          <tr key={record.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                            <td className="px-4 py-2 font-mono text-slate-300">{record.name === "" ? "@" : record.name}</td>
                            <td className="px-4 py-2 font-semibold text-emerald-400">{record.type}</td>
                            <td className="px-4 py-2 font-mono">{record.ttl}</td>
                            <td className="px-4 py-2 text-slate-200 truncate max-w-[200px]">{record.content}</td>
                            <td className="px-4 py-2">
                              <button onClick={() => handleDeleteRecord(record.id)} className="text-slate-600 hover:text-red-400 p-1">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <form onSubmit={(e) => handleAddRecord(e, zone.id)} className="flex items-center gap-2 bg-[#0b1120] p-3 rounded-lg border border-slate-800/80">
                      <input type="text" value={newRecord.name} onChange={e=>setNewRecord({...newRecord, name: e.target.value})} placeholder="Host (@)" className="w-24 bg-transparent border-b border-slate-700 pb-1 text-sm text-slate-200 focus:outline-none" />
                      
                      <select value={newRecord.type} onChange={e=>setNewRecord({...newRecord, type: e.target.value})} className="bg-slate-900 border border-slate-700 text-sm rounded px-2 py-1 text-emerald-400 font-bold focus:outline-none">
                        <option>A</option>
                        <option>AAAA</option>
                        <option>CNAME</option>
                        <option>TXT</option>
                        <option>MX</option>
                        <option>SRV</option>
                      </select>

                      <input type="number" value={newRecord.ttl} onChange={e=>setNewRecord({...newRecord, ttl: parseInt(e.target.value)})} placeholder="TTL" className="w-16 bg-transparent border-b border-slate-700 pb-1 text-sm text-center text-slate-200 focus:outline-none font-mono" />

                      <input type="text" value={newRecord.content} onChange={e=>setNewRecord({...newRecord, content: e.target.value})} placeholder="Alamat IP / Tujuan / Data" className="flex-1 bg-transparent border-b border-slate-700 pb-1 text-sm text-slate-200 focus:outline-none font-mono" required />

                      <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-xs font-bold transition-colors">Tambah</button>
                    </form>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
