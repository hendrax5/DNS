/* eslint-disable react/prop-types */
import { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Activity, 
  Lock, 
  Globe, 
  Server, 
  RefreshCw, 
  BarChart2, 
  ShieldAlert,
  CheckCircle2,
  ExternalLink,
  Cpu,
  HardDrive
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [adminTab, setAdminTab] = useState('threats');
  const [stats, setStats] = useState(null);
  const [lamanLabuh, setLamanLabuh] = useState([]);
  const [aclList, setAclList] = useState([]);
  const [rpzFeeds, setRpzFeeds] = useState([]);
  const [customBlacklist, setCustomBlacklist] = useState([]);
  const [customWhitelist, setCustomWhitelist] = useState([]);
  const [searchRpzQuery, setSearchRpzQuery] = useState('');
  const [searchRpzResults, setSearchRpzResults] = useState([]);
  const [isSearchingRpz, setIsSearchingRpz] = useState(false);
  const [rpzAXFR, setRpzAXFR] = useState([]);
  const [syncInterval, setSyncInterval] = useState(1);
  const [domainForwarders, setDomainForwarders] = useState('');
  const [parentResolvers, setParentResolvers] = useState(['', '', '', '', '', '']);
  const [saveStatus, setSaveStatus] = useState({ show: false, message: '', type: '' });
  const [liveLogs, setLiveLogs] = useState([]);
  const [topAnalytics, setTopAnalytics] = useState({ clients: [], domains: [] });

  // Advanced Config
  const [safeSearch, setSafeSearch] = useState(false);
  const [dnssec, setDnssec] = useState(false);
  const [tproxy, setTproxy] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        setStats(data);
      } catch (e) {
        setStats({
          qps: 125432, cache_hit_ratio: 94.2, avg_latency_ms: 42.3, cpu_usage: 23, mem_usage_mb: 4200,
          rpz_status: [{ name: "KOMINFO Trust Positif", status: "Mock", time: "Just now", records: 2400000 }]
        });
      }
    };
    fetchStats();
    const iv = setInterval(fetchStats, 2000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProto}//${window.location.host}/ws`);
    ws.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data);
        setLiveLogs(prev => [log, ...prev].slice(0, 50));
      } catch (e) {}
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    if (activeTab === 'dashboard') {
      const fetchTop = async () => {
        try {
          const res = await fetch('/api/top-analytics');
          const data = await res.json();
          setTopAnalytics({
            clients: (data.top_clients || []).sort((a,b)=>b.count-a.count).slice(0, 5),
            domains: (data.top_domains || []).sort((a,b)=>b.count-a.count).slice(0, 5)
          });
        } catch(e) {}
      };
      fetchTop();
      const iv = setInterval(fetchTop, 5000);
      return () => clearInterval(iv);
    }
  }, [activeTab]);

  const loadSettings = async () => {
    try {
      const resLL = await fetch('/api/laman-labuh');
      const dataLL = await resLL.json();
      if(dataLL.ips) setLamanLabuh(dataLL.ips.filter(Boolean));

      const resACL = await fetch('/api/acl');
      const dataACL = await resACL.json();
      if(dataACL.ips) setAclList(dataACL.ips.filter(Boolean));

      const resRPZ = await fetch('/api/rpz-feeds');
      const dataRPZ = await resRPZ.json();
      if(dataRPZ.feeds) setRpzFeeds(dataRPZ.feeds);
      if(dataRPZ.sync_interval) setSyncInterval(dataRPZ.sync_interval);

      const resCustom = await fetch('/api/custom-lists');
      const dataCustom = await resCustom.json();
      if(dataCustom.blacklist) setCustomBlacklist(dataCustom.blacklist);
      if(dataCustom.whitelist) setCustomWhitelist(dataCustom.whitelist);

      const resAXFR = await fetch('/api/rpz-axfr');
      const dataAXFR = await resAXFR.json();
      if(dataAXFR.feeds) setRpzAXFR(dataAXFR.feeds);

      const resFwd = await fetch('/api/forwarders');
      const dataFwd = await resFwd.json();
      if(dataFwd.domain_forwarders !== undefined) setDomainForwarders(dataFwd.domain_forwarders);
      if(dataFwd.parent_resolvers) setParentResolvers(dataFwd.parent_resolvers);

      const resAdv = await fetch('/api/advanced-config');
      const dataAdv = await resAdv.json();
      if(dataAdv.safesearch !== undefined) setSafeSearch(dataAdv.safesearch);
      if(dataAdv.dnssec !== undefined) setDnssec(dataAdv.dnssec);
    } catch(e) { console.error(e) }
  };

  useEffect(() => {
    if (activeTab === 'admin') loadSettings();
  }, [activeTab]);

  const showNotification = (message, type = 'success') => {
    setSaveStatus({ show: true, message, type });
    setTimeout(() => setSaveStatus({ show: false, message: '', type: '' }), 3000);
  };

  const saveLamanLabuh = async () => {
    try {
      const ips = lamanLabuh.map(i=>i.trim()).filter(i=>i);
      await fetch('/api/laman-labuh', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ips})
      });
      showNotification('Laman Labuh updated successfully');
    } catch(e) { showNotification('Failed to update Laman Labuh', 'error'); }
  };

  const saveACL = async () => {
    try {
      const ips = aclList.map(i=>i.trim()).filter(i=>i);
      await fetch('/api/acl', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ips})
      });
      showNotification('Access Control List (ACL) enforced');
    } catch(e) { showNotification('Failed to update ACL', 'error'); }
  };

  const saveAdvancedConfig = async () => {
    try {
      await fetch('/api/advanced-config', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({safesearch: safeSearch, dnssec})
      });
      showNotification('Advanced Security Settings Applied!');
    } catch(e) { showNotification('Failed to save settings', 'error'); }
  };

  const saveRPZ = async () => {
    try {
      await fetch('/api/rpz-feeds', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ feeds: rpzFeeds.filter(f => f.url.trim()), sync_interval: syncInterval })
      });
      showNotification('RPZ Feeds scheduled for sync');
    } catch(e) { showNotification('Failed to update RPZ', 'error'); }
  };

  const saveCustomLists = async () => {
    try {
      await fetch('/api/custom-lists', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          blacklist: customBlacklist.map(d=>d.trim()).filter(d=>d),
          whitelist: customWhitelist.map(d=>d.trim()).filter(d=>d)
        })
      });
      showNotification('Custom Filters saved and Rule Engine compiled', 'success');
    } catch(e) { showNotification('Failed to save Custom Lists', 'error'); }
  };

  const handleSearchRpz = async (e) => {
    e.preventDefault();
    if (searchRpzQuery.length < 3) return showNotification('Query min 3 chars', 'error');
    setIsSearchingRpz(true);
    try {
      const res = await fetch('/api/search-rpz?q=' + encodeURIComponent(searchRpzQuery));
      const data = await res.json();
      setSearchRpzResults(data.results || []);
      if (data.results?.length === 0) showNotification('Tidak ada domain yang cocok.', 'success');
    } catch(err) {
      showNotification('Gagal mencari di Database RPZ', 'error');
    } finally {
      setIsSearchingRpz(false);
    }
  };

  const saveAXFR = async () => {
    try {
      await fetch('/api/rpz-axfr', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ feeds: rpzAXFR.filter(f => f.master_ip.trim() && f.zone_name.trim()) })
      });
      showNotification('Native Zone IXFR Configured Successfully');
    } catch(e) { showNotification('Failed to update AXFR Masters', 'error'); }
  };

  const saveForwarders = async () => {
    try {
      await fetch('/api/forwarders', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
           domain_forwarders: domainForwarders,
           parent_resolvers: parentResolvers
        })
      });
      showNotification('Forwarding rules synchronized successfully');
    } catch(e) { showNotification('Failed to upload Forwarders', 'error'); }
  };

  const [chartData] = useState(() => Array.from({ length: 20 }).map((_, i) => ({
    time: i,
    qps: 120000 + Math.random() * 10000,
    blocked: 45000 + Math.random() * 5000,
  })));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans selection:bg-emerald-500/30">
      
      {/* Top Navigation - Enterprise Trust Authority */}
      <nav className="w-full bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 text-emerald-500" />
            <span className="text-xl font-bold tracking-tight text-white">NetShield<span className="text-slate-400 font-medium">Enterprise</span></span>
          </div>
          
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 cursor-pointer ${
                activeTab === 'dashboard' 
                  ? 'bg-slate-800 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Activity className="w-4 h-4 inline-block mr-2" />
              Monitoring
            </button>
            <button 
              onClick={() => setActiveTab('admin')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 cursor-pointer ${
                activeTab === 'admin' 
                  ? 'bg-slate-800 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Lock className="w-4 h-4 inline-block mr-2" />
              Security Policies
            </button>
          </div>
        </div>
      </nav>

      {/* Global Notification */}
      <div className={`fixed top-20 right-6 z-50 transition-all duration-300 transform ${saveStatus.show ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0 pointer-events-none'}`}>
        <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg ${saveStatus.type === 'error' ? 'bg-red-950/90 border-red-900/50 text-red-200' : 'bg-emerald-950/90 border-emerald-900/50 text-emerald-200'}`}>
          <CheckCircle2 className={`w-5 h-5 ${saveStatus.type === 'error' ? 'text-red-400' : 'text-emerald-400'}`} />
          <p className="font-medium text-sm">{saveStatus.message}</p>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {activeTab === 'dashboard' ? (
          <div className="space-y-6">
            <div className="flex justify-between items-end">
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">System Telemetry</h1>
                <p className="text-slate-400 text-sm mt-1">Real-time performance and threat intelligence monitoring.</p>
              </div>
              <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-md border border-emerald-500/20">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                Protected & Online
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl hover:border-slate-700 transition-colors duration-200 cursor-pointer">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-slate-400 font-medium text-sm">Queries / Second</h3>
                  <Activity className="w-5 h-5 text-blue-500" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tracking-tight text-white">{stats ? stats.qps.toLocaleString() : '...'}</span>
                  <span className="text-xs text-emerald-400 font-medium">Live</span>
                </div>
              </div>
              
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl hover:border-slate-700 transition-colors duration-200 cursor-pointer">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-slate-400 font-medium text-sm">Cache Hit Ratio</h3>
                  <Server className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tracking-tight text-white">{stats ? stats.cache_hit_ratio : '...'}%</span>
                  <span className="text-xs text-emerald-400 font-medium">Optimal</span>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl hover:border-slate-700 transition-colors duration-200 cursor-pointer">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-slate-400 font-medium text-sm">Recursive Latency</h3>
                  <Globe className="w-5 h-5 text-slate-400" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tracking-tight text-white">{stats ? stats.avg_latency_ms : '...'}</span>
                  <span className="text-lg text-slate-500 ml-1">ms</span>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl hover:border-slate-700 transition-colors duration-200 cursor-pointer">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-slate-400 font-medium text-sm">CPU Usage</h3>
                  <Cpu className="w-5 h-5 text-amber-500" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tracking-tight text-white">{stats ? stats.cpu_usage : '...'}%</span>
                  <span className="text-xs text-emerald-400 font-medium">Stable</span>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl hover:border-slate-700 transition-colors duration-200 cursor-pointer">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-slate-400 font-medium text-sm">Real Memory</h3>
                  <HardDrive className="w-5 h-5 text-purple-500" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tracking-tight text-white">{stats ? stats.mem_usage_mb : '...'}</span>
                  <span className="text-lg text-slate-500 ml-1">MB</span>
                </div>
              </div>

            </div>

            {/* Domain Checker Widget */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex items-center justify-between gap-6">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2 mb-2">
                  <Globe className="w-4 h-4" /> Diagnostik Domain (Checker)
                </h3>
                <p className="text-xs text-slate-500">Ketahui secara instan apakah domain tertentu dibidik oleh RPZ/AXFR ISP/Kominfo.</p>
              </div>
              <div className="flex flex-1 items-center gap-3">
                <input 
                  type="text" 
                  id="checkDomainInput"
                  onKeyDown={e => {
                    if (e.key === 'Enter') document.getElementById('btnCheckDomain').click()
                  }}
                  placeholder="misal. x.com" 
                  className="flex-1 bg-[#0b1120] border border-slate-700/50 rounded-lg px-4 py-2 text-sm font-mono text-slate-300 focus:outline-none focus:border-indigo-500/50 shadow-inner"
                />
                <button 
                  id="btnCheckDomain"
                  onClick={async () => {
                    const btn = document.getElementById('btnCheckDomain');
                    const origText = btn.innerText;
                    btn.innerText = 'Memeriksa...';
                    try {
                      const domain = document.getElementById('checkDomainInput').value.trim();
                      if(!domain) return;
                      const res = await fetch('/api/check-domain?domain=' + encodeURIComponent(domain));
                      const data = await res.json();
                      if(data.is_blocked) {
                        showNotification(`LOCKED: ${domain} dicekal! (Dialihkan ke: ${data.resolve_to})`, 'error');
                      } else {
                        showNotification(`ALLOW: ${domain} bersih dari blokir. (${data.resolve_to || 'NXDOMAIN'})`, 'success');
                      }
                    } catch (e) {
                      showNotification('Gagal menghubungi Engine DNS', 'error');
                    } finally {
                      btn.innerText = origText;
                    }
                  }}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm text-white rounded-lg transition-colors shadow-[0_0_15px_rgba(79,70,229,0.3)] whitespace-nowrap cursor-pointer"
                >
                  Cek Domain
                </button>
              </div>
            </div>

            {/* Charts & Intel */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Traffic Chart */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-6 rounded-xl">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-200 mb-6">
                  <BarChart2 className="w-5 h-5 text-slate-400" /> Tren Lalu Lintas (60 Detik)
                </h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorQps" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorBlocked" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="4 4" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="time" hide />
                      <YAxis stroke="#475569" tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} />
                      <Tooltip 
                        contentStyle={{backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc'}}
                        cursor={{stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4'}}
                      />
                      <Area type="monotone" name="Total Permintaan" dataKey="qps" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorQps)" animationDuration={300} isAnimationActive={false} />
                      <Area type="monotone" name="Diblokir RPZ/ACL" dataKey="blocked" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorBlocked)" animationDuration={300} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Threat Feeds */}
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-200 mb-6">
                  <ShieldAlert className="w-5 h-5 text-slate-400" /> DNS RPZ Feeds
                </h3>
                <div className="flex flex-col gap-4">
                  {stats?.rpz_status?.map((feed, i) => (
                    <div key={i} className="flex flex-col p-4 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer group">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-semibold text-sm text-slate-200">{feed.name}</span>
                        <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> {feed.status}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs text-slate-500">
                        <span>{feed.records !== undefined ? feed.records.toLocaleString() + " Domain Valid" : "~2.4M Signatures"}</span>
                        <span>{feed.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Live Intelligence Stream */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl mt-6">
              <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-200 mb-4">
                <Activity className="w-5 h-5 text-emerald-400" /> Pemantauan Kueri Langsung (Live Stream)
              </h3>
              <div className="bg-slate-950 font-mono text-xs rounded-lg p-4 h-64 overflow-y-auto border border-slate-800">
                {liveLogs.length === 0 ? (
                  <span className="text-slate-500">Menunggu kueri masuk...</span>
                ) : (
                  liveLogs.map((log, i) => (
                    <div key={i} className="flex gap-4 py-1.5 border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20 items-center">
                      <span className="text-slate-500 w-20">{log.time ? new Date(log.time * 1000).toLocaleTimeString() : '--:--:--'}</span>
                      <span className={`w-20 font-semibold ${log.action === 'ALLOW' ? 'text-emerald-500' : (log.action === 'DROP_ACL' ? 'text-rose-500' : 'text-orange-500')}`}>{log.action}</span>
                      <span className="text-blue-400 w-32 truncate">{log.ip}</span>
                      <span className="text-slate-300 flex-1 truncate">{log.qname}</span>
                      <span className="text-slate-500 w-12 text-right">IN {log.type}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Top Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
               <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
                 <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider">Wawasan Klien Teratas (Top Clients)</h3>
                 <div className="space-y-3">
                   {topAnalytics.clients.map((c, i) => (
                     <div key={i} className="flex justify-between items-center px-4 py-2 bg-slate-950 rounded-lg border border-slate-800/50">
                       <span className="text-blue-400 text-sm font-mono flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500"></div>{c.name}</span>
                       <div className="flex gap-2 text-xs font-medium">
                         <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">{c.allow ? c.allow.toLocaleString() : 0} Diizinkan</span>
                         <span className="text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">{c.block ? c.block.toLocaleString() : 0} Diblokir</span>
                       </div>
                     </div>
                   ))}
                   {topAnalytics.clients.length === 0 && <span className="text-slate-500 text-sm">Belum ada data...</span>}
                 </div>
               </div>
               
               <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
                 <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider">Domain Terbanyak Diakses</h3>
                 <div className="space-y-3">
                   {topAnalytics.domains.map((d, i) => (
                     <div key={i} className="flex justify-between items-center px-4 py-2 bg-slate-950 rounded-lg border border-slate-800/50">
                       <span className="text-slate-300 text-sm truncate pr-2 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div>{d.name}</span>
                       <span className="text-slate-400 font-medium text-sm">{d.count.toLocaleString()}</span>
                     </div>
                   ))}
                   {topAnalytics.domains.length === 0 && <span className="text-slate-500 text-sm">Belum ada data...</span>}
                 </div>
               </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6 flex flex-col h-full">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Kebijakan Keamanan</h1>
              <p className="text-slate-400 text-sm mt-1">Kelola perutean intelijen ancaman, akses jaringan, dan kepatuhan keamanan.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-4">
              <button onClick={() => setAdminTab('threats')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${adminTab === 'threats' ? 'bg-fuchsia-600 text-white shadow-[0_0_15px_rgba(192,38,211,0.3)]' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}><ShieldAlert className="w-4 h-4 inline-block mr-2" />Intelijen Ancaman & RPZ</button>
              <button onClick={() => setAdminTab('forwarding')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${adminTab === 'forwarding' ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.3)]' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}><Globe className="w-4 h-4 inline-block mr-2" />Penerusan Global</button>
              <button onClick={() => setAdminTab('access')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${adminTab === 'access' ? 'bg-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}><ShieldCheck className="w-4 h-4 inline-block mr-2" />Kontrol Akses</button>
              <button onClick={() => setAdminTab('options')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${adminTab === 'options' ? 'bg-amber-600 text-white shadow-[0_0_15px_rgba(217,119,6,0.3)]' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}><Server className="w-4 h-4 inline-block mr-2" />Opsi Keamanan</button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              
              {/* === TAB: THREATS === */}
              {adminTab === 'threats' && (
                <>
              {/* Laman Labuh Drop/Rewrite Config */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                <div className="p-6 border-b border-slate-800">
                  <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                    <Globe className="w-5 h-5 text-slate-400" />
                    Bypass Aturan (Laman Labuh)
                  </h2>
                  <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                    Atur alamat IP target untuk mencegat lalu lintas domain yang diblokir RPZ. Banyak IP akan bertindak sebagai kumpulan load-balancing.
                  </p>
                </div>
                
                <div className="p-6 bg-slate-950/50 flex flex-col flex-1">
                  <div className="flex flex-col gap-3 flex-1 overflow-y-auto pr-2">
                    {lamanLabuh.map((ip, i) => (
                      <div key={i} className="flex items-center gap-3 bg-[#0b1120] p-3 rounded-lg border border-slate-800/80 shadow-inner">
                        <input
                           type="text"
                           value={ip}
                           onChange={e => {
                               const next = [...lamanLabuh];
                               next[i] = e.target.value;
                               setLamanLabuh(next);
                           }}
                           className="flex-1 bg-transparent text-sm font-mono text-slate-300 focus:outline-none placeholder:text-slate-700"
                           placeholder="Alamat IP"
                        />
                        <button
                           onClick={() => setLamanLabuh(lamanLabuh.filter((_, idx) => idx !== i))}
                           className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer p-1"
                        >
                           ✕
                        </button>
                      </div>
                    ))}
                    <button
                        onClick={() => setLamanLabuh([...lamanLabuh, ''])}
                        className="mt-2 text-sm text-emerald-400 hover:text-emerald-300 flex items-center justify-center py-2.5 border border-dashed border-emerald-900/50 rounded-lg cursor-pointer transition-colors bg-emerald-950/10 hover:bg-emerald-950/30"
                    >
                        + Tambah IP Baru
                    </button>
                  </div>
                </div>
                <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end">
                  <button 
                    onClick={saveLamanLabuh}
                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors duration-200 cursor-pointer flex items-center gap-2"
                  >
                    Simpan Konfigurasi
                  </button>
                </div>
              </div>

                  {/* AXFR Native Zone Config */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                    <div className="p-6 border-b border-slate-800">
                      <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                        <DatabaseIcon className="w-5 h-5 text-indigo-400" />
                        AXFR/IXFR DNS Master
                      </h2>
                      <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                        Protokol Zone Transfer Asli yang terhubung langsung ke Server Pusat BSSN/Kominfo (melewati HTTP).
                      </p>
                    </div>
                    
                    <div className="p-6 bg-slate-950/50 flex flex-col flex-1">
                      <div className="flex flex-col gap-3 flex-1 overflow-y-auto pr-2">
                        {rpzAXFR.map((feed, i) => (
                          <div key={i} className="flex flex-col gap-2 bg-[#0b1120] p-4 rounded-lg border border-slate-800/80 shadow-inner">
                            <div className="flex items-center gap-3">
                               <input
                                  type="text"
                                  value={feed.master_ip}
                                  onChange={e => {
                                      const next = [...rpzAXFR];
                                      next[i].master_ip = e.target.value;
                                      setRpzAXFR(next);
                                  }}
                                  className="w-1/2 bg-transparent border-b border-slate-800 pb-1 text-sm font-mono text-slate-300 focus:outline-none focus:border-indigo-500 placeholder:text-slate-700"
                                  placeholder="IP Master (e.g. 182.23.79.202)"
                               />
                               <input
                                  type="text"
                                  value={feed.zone_name}
                                  onChange={e => {
                                      const next = [...rpzAXFR];
                                      next[i].zone_name = e.target.value;
                                      setRpzAXFR(next);
                                  }}
                                  className="w-1/2 bg-transparent border-b border-slate-800 pb-1 text-sm font-mono text-slate-300 focus:outline-none focus:border-indigo-500 placeholder:text-slate-700"
                                  placeholder="Zone (e.g. trustpositifkominfo)"
                               />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                               <button
                                  onClick={() => {
                                      const next = [...rpzAXFR];
                                      next[i].enabled = !next[i].enabled;
                                      setRpzAXFR(next);
                                  }}
                                  className={`px-3 py-1 rounded text-xs font-bold transition-all whitespace-nowrap ${feed.enabled ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 shadow-[0_0_10px_rgba(79,70,229,0.15)]' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}
                               >
                                  {feed.enabled ? 'PROTOCOL ENABLED' : 'DISABLED'}
                               </button>
                               <button
                                  onClick={() => setRpzAXFR(rpzAXFR.filter((_, idx) => idx !== i))}
                                  className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer text-xs"
                               >
                                  ✕ Buang
                               </button>
                            </div>
                          </div>
                        ))}
                        <button
                            onClick={() => setRpzAXFR([...rpzAXFR, {master_ip: '', zone_name: '', enabled: false}])}
                            className="mt-2 text-sm text-indigo-400 hover:text-indigo-300 flex items-center justify-center py-2.5 border border-dashed border-indigo-900/50 rounded-lg cursor-pointer transition-colors bg-indigo-950/10 hover:bg-indigo-950/30"
                        >
                            + Tambah Master AXFR Server
                        </button>
                      </div>
                    </div>
                    <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end">
                      <button 
                        onClick={saveAXFR}
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors duration-200 cursor-pointer flex items-center gap-2"
                      >
                        Deploy AXFR Rules
                      </button>
                    </div>
                  </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                <div className="p-6 border-b border-slate-800">
                  <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                    <ShieldAlert className="w-5 h-5 text-slate-400" />
                    Bahan Baku DNS (Feeds)
                  </h2>
                  <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                    Masukkan URL untuk mengunduh arsip zona RPZ (misal. Kominfo Trust Positif) atau daftar blokir khusus format blok.
                  </p>
                </div>
                
                <div className="p-6 bg-slate-950/50 flex flex-col flex-1">
                  <div className="flex flex-col gap-3 flex-1 overflow-y-auto pr-2">
                    {rpzFeeds.map((feed, i) => {
                      const syncData = stats?.rpz_status?.find(s => s.url === feed.url);
                      const isError = syncData && syncData.status !== "Synced & Parsed" && syncData.status !== "Disabled" && syncData.status !== "Mock";
                      return (
                      <div key={i} className="flex items-center gap-3 bg-[#0b1120] p-3 rounded-lg border border-slate-800/80 shadow-inner flex-wrap">
                        <input
                           type="text"
                           value={feed.url}
                           onChange={e => {
                               const next = [...rpzFeeds];
                               next[i].url = e.target.value;
                               setRpzFeeds(next);
                           }}
                           className="flex-1 min-w-[200px] bg-transparent text-sm font-mono text-slate-300 focus:outline-none placeholder:text-slate-700"
                           placeholder="https://..."
                        />
                        {syncData && (
                          <div className="flex-none px-2 flex items-center gap-1.5">
                            {isError ? (
                              <span className="text-xs bg-red-500/10 text-red-400 font-semibold px-2 py-1 rounded flex items-center gap-1 shadow-sm border border-red-500/20" title={syncData.error}>
                                ⚠️ {syncData.status}
                              </span>
                            ) : syncData.status === "Synced & Parsed" ? (
                              <span className="text-xs bg-emerald-500/10 text-emerald-400 font-semibold px-2 py-1 rounded flex items-center gap-1 shadow-sm border border-emerald-500/20">
                                <CheckCircle2 className="w-3 h-3" /> {syncData.records.toLocaleString()} Baris
                              </span>
                            ) : (
                              <span className="text-xs text-slate-500 font-semibold px-2 py-1">{syncData.status}</span>
                            )}
                          </div>
                        )}
                        <button
                           onClick={() => {
                               const next = [...rpzFeeds];
                               next[i].enabled = !next[i].enabled;
                               setRpzFeeds(next);
                           }}
                           className={`px-3 py-1 rounded text-xs font-bold transition-all whitespace-nowrap ${feed.enabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.15)]' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}
                        >
                           {feed.enabled ? 'ENABLED' : 'DISABLED'}
                        </button>
                        <button
                           onClick={() => setRpzFeeds(rpzFeeds.filter((_, idx) => idx !== i))}
                           className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer p-1"
                        >
                           ✕
                        </button>
                        {isError && syncData.error && (
                          <div className="w-full mt-1 text-[10px] text-red-400/80 font-mono tracking-wide px-1 truncate">
                            {syncData.error}
                          </div>
                        )}
                      </div>
                    )})}
                    <button
                        onClick={() => setRpzFeeds([...rpzFeeds, {url: '', enabled: true}])}
                        className="mt-2 text-sm text-blue-400 hover:text-blue-300 flex items-center justify-center py-2.5 border border-dashed border-blue-900/50 rounded-lg cursor-pointer transition-colors bg-blue-950/10 hover:bg-blue-950/30"
                    >
                        + Tambah URL Baru
                    </button>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
                     <span className="text-xs text-slate-400 font-bold tracking-widest uppercase">Sinkronisasi Otomatis Interval</span>
                     <div className="flex items-center gap-2">
                        <input 
                           type="number" 
                           value={syncInterval} 
                           onChange={e => setSyncInterval(parseInt(e.target.value) || 1)}
                           className="w-16 bg-[#0b1120] border border-slate-700/50 rounded px-2 py-1.5 text-center text-sm font-mono text-indigo-300 focus:outline-none focus:border-indigo-500/50 transition-colors"
                           min="1"
                        />
                        <span className="text-xs text-slate-500 font-medium">Menit</span>
                     </div>
                  </div>
                </div>
                <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end">
                  <button 
                    onClick={saveRPZ}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors duration-200 cursor-pointer flex items-center gap-2"
                  >
                    Simpan & Tarik Data
                  </button>
                </div>
              </div>

              {/* RPZ Database Search Engine */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden lg:col-span-3">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-800/20">
                  <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                      <ExternalLink className="w-5 h-5 text-fuchsia-400" />
                      Mesin Pencarian Database RPZ
                    </h2>
                    <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                      Lakukan diagnosa cek Domain di jutaan arsip Intelijen untuk memastikan apakah domain/TLD telah diblokir.
                    </p>
                  </div>
                </div>
                
                <div className="p-6 bg-slate-950/50 flex flex-col gap-4">
                  <form onSubmit={handleSearchRpz} className="flex items-center gap-3">
                    <input 
                      type="text" 
                      value={searchRpzQuery}
                      onChange={e => setSearchRpzQuery(e.target.value)}
                      placeholder="misal. x.com atau judi" 
                      className="flex-1 max-w-lg bg-[#0b1120] border border-slate-700/50 rounded-lg px-4 py-2.5 text-sm font-mono text-slate-300 focus:outline-none focus:border-fuchsia-500/50 shadow-inner"
                    />
                    <button 
                      type="submit"
                      disabled={isSearchingRpz}
                      className="px-6 py-2.5 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg shadow-[0_0_15px_rgba(192,38,211,0.2)] transition-all duration-200 cursor-pointer whitespace-nowrap"
                    >
                      {isSearchingRpz ? 'Mencari...' : 'Cari di Database'}
                    </button>
                  </form>
                  
                  {searchRpzResults.length > 0 && (
                    <div className="mt-4 border border-slate-800 rounded-lg overflow-hidden">
                      <div className="bg-slate-900 p-2 border-b border-slate-800 text-xs font-semibold tracking-wider text-slate-400 uppercase">
                        Hasil Pencarian ({searchRpzResults.length} data cocok)
                      </div>
                      <div className="max-h-60 overflow-y-auto bg-slate-950 p-2 flex flex-col gap-1">
                        {searchRpzResults.map((res, i) => (
                          <div key={i} className="px-3 py-1.5 hover:bg-slate-800/50 rounded text-sm font-mono text-slate-300 flex justify-between items-center group">
                            <span>{res.split(' ')[0]}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${res.includes('[WHITELISTED]') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                              {res.includes('[WHITELISTED]') ? 'DIIZINKAN' : 'DIBLOKIR RPZ'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              </>
              )}

              {/* === TAB: ACCESS CONTROL === */}
              {adminTab === 'access' && (
                <>
                  {/* ACL Config */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                    <div className="p-6 border-b border-slate-800">
                      <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                        <Lock className="w-5 h-5 text-slate-400" />
                        Kontrol Akses Klien (ACL)
                      </h2>
                      <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                        Tetapkan subnet IP (CIDR) yang diizinkan menggunakan DNS resolver ini. Permintaan tidak dikenal akan ditolak seketika (Drop).
                      </p>
                    </div>
                    
                    <div className="p-6 bg-slate-950/50 flex flex-col flex-1">
                      <div className="flex flex-col gap-3 flex-1 overflow-y-auto pr-2">
                        {aclList.map((acl, i) => (
                          <div key={i} className="flex items-center gap-3 bg-[#0b1120] p-3 rounded-lg border border-slate-800/80 shadow-inner">
                            <input
                               type="text"
                               value={acl}
                               onChange={e => {
                                   const next = [...aclList];
                                   next[i] = e.target.value;
                                   setAclList(next);
                               }}
                               className="flex-1 bg-transparent text-sm font-mono text-slate-300 focus:outline-none placeholder:text-slate-700"
                               placeholder="CIDR (e.g. 192.168.1.0/24)"
                            />
                            <button
                               onClick={() => setAclList(aclList.filter((_, idx) => idx !== i))}
                               className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer p-1"
                            >
                               ✕
                            </button>
                          </div>
                        ))}
                        <button
                            onClick={() => setAclList([...aclList, ''])}
                            className="mt-2 text-sm text-emerald-400 hover:text-emerald-300 flex items-center justify-center py-2.5 border border-dashed border-emerald-900/50 rounded-lg cursor-pointer transition-colors bg-emerald-950/10 hover:bg-emerald-950/30"
                        >
                            + Tambah Subnet Baru
                        </button>
                      </div>
                    </div>
                    <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end">
                      <button 
                        onClick={saveACL}
                        className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors duration-200 cursor-pointer flex items-center gap-2"
                      >
                        Terapkan ACL
                      </button>
                    </div>
                  </div>

              {/* Custom Whitelist & Blacklist Arrays */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden lg:col-span-2">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-800/20">
                  <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                      <ShieldCheck className="w-5 h-5 text-emerald-400" />
                      Pengecualian Aturan Khusus
                    </h2>
                    <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                      Masukkan domain ke Daftar Diizinkan (Whitelist) untuk melewati blokir RPZ, atau masukkan ke Daftar Blokir (Blacklist) untuk memaksa pemblokiran. 
                    </p>
                  </div>
                  <button 
                    onClick={saveCustomLists}
                    className="px-8 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-lg shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all duration-200 cursor-pointer flex items-center gap-2"
                  >
                    Kompilasi Daftar Kustom
                  </button>
                </div>
                
                <div className="p-6 bg-slate-950/50 flex flex-col lg:flex-row gap-10 flex-1">
                  
                  {/* Whitelist Panel */}
                  <div className="flex-1 flex flex-col gap-4">
                     <label className="block text-sm font-bold text-emerald-400 tracking-widest uppercase flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4" /> Daftar Diizinkan (Whitelist)
                     </label>
                     <p className="text-xs text-slate-500 mb-2 leading-relaxed">Bebas dari semua blokir RPZ dan Master Feeds.</p>
                     
                     <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-2">
                        {customWhitelist.map((domain, i) => (
                           <div key={i} className="flex items-center gap-2 bg-[#0b1120] border border-emerald-900/30 p-2 rounded-lg">
                              <input 
                                 type="text" 
                                 value={domain}
                                 onChange={e => {
                                    const next = [...customWhitelist];
                                    next[i] = e.target.value;
                                    setCustomWhitelist(next);
                                 }}
                                 placeholder="misal. situs-aman.com"
                                 className="flex-1 bg-transparent text-emerald-100 font-mono text-sm px-2 focus:outline-none placeholder:text-emerald-900/50"
                              />
                              <button onClick={() => setCustomWhitelist(customWhitelist.filter((_, idx)=>idx!==i))} className="text-emerald-700 hover:text-red-400 p-1">✕</button>
                           </div>
                        ))}
                     </div>
                     <button onClick={() => setCustomWhitelist([...customWhitelist, ''])} className="mt-2 py-2 text-xs font-bold text-emerald-500/70 border border-dashed border-emerald-800/50 rounded hover:bg-emerald-900/20 transition-colors">
                        + Pasang Domain Whitelist
                     </button>
                  </div>

                  {/* Blacklist Panel */}
                  <div className="flex-1 flex flex-col gap-4 border-t pt-6 lg:border-t-0 lg:pt-0 lg:border-l lg:pl-10 border-slate-800">
                     <label className="block text-sm font-bold text-red-500 tracking-widest uppercase flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4" /> Daftar Blokir (Blacklist)
                     </label>
                     <p className="text-xs text-slate-500 mb-2 leading-relaxed">Domain ini akan langsung diblokir secara mutlak.</p>

                     <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-2">
                        {customBlacklist.map((domain, i) => (
                           <div key={i} className="flex items-center gap-2 bg-[#0b1120] border border-red-900/30 p-2 rounded-lg">
                              <input 
                                 type="text" 
                                 value={domain}
                                 onChange={e => {
                                    const next = [...customBlacklist];
                                    next[i] = e.target.value;
                                    setCustomBlacklist(next);
                                 }}
                                 placeholder="e.g. bad-site.com"
                                 className="flex-1 bg-transparent text-red-100 font-mono text-sm px-2 focus:outline-none placeholder:text-red-900/50"
                              />
                              <button onClick={() => setCustomBlacklist(customBlacklist.filter((_, idx)=>idx!==i))} className="text-red-700 hover:text-red-400 p-1">✕</button>
                           </div>
                        ))}
                     </div>
                     <button onClick={() => setCustomBlacklist([...customBlacklist, ''])} className="mt-2 py-2 text-xs font-bold text-red-500/70 border border-dashed border-red-800/50 rounded hover:bg-red-900/20 transition-colors">
                        + Pasang Domain Blocklist
                     </button>
                  </div>

                </div>
              </div>
              </>
              )}

              {/* === TAB: GLOBAL FORWARDING === */}
              {adminTab === 'forwarding' && (
                <>
              {/* Kominfo Forwarders Config */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden lg:col-span-2">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-800/20">
                  <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                      <ExternalLink className="w-5 h-5 text-indigo-400" />
                      Forwarder & Parent Resolver
                    </h2>
                    <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                      Implementasikan kebijakan Conditional Forwarding sesuai standar Nasional.
                    </p>
                  </div>
                  <button 
                    onClick={saveForwarders}
                    className="px-8 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg shadow-[0_0_15px_rgba(79,70,229,0.3)] transition-all duration-200 cursor-pointer flex items-center gap-2"
                  >
                    Simpan Konfigurasi
                  </button>
                </div>
                
                <div className="p-6 bg-slate-950/50 flex flex-col lg:flex-row gap-10 flex-1">
                  
                  {/* Domain Forwarder */}
                  <div className="flex-1 flex flex-col gap-2">
                     <label className="block text-sm font-bold text-white tracking-widest uppercase">Domain Forwarder</label>
                     <p className="text-xs text-slate-400 mb-2 leading-relaxed">
                        Format: <code className="text-indigo-300 bg-indigo-900/30 px-1 py-0.5 rounded">domain_name,ip_resolver1,ip_resolver2,...</code><br/>
                        Peringatan: salah isi DNS bisa tidak berfungsi!
                     </p>
                     <textarea 
                        value={domainForwarders}
                        onChange={e => setDomainForwarders(e.target.value)}
                        className="w-full flex-1 min-h-[250px] bg-[#0b1120] border border-slate-700/50 rounded-lg p-5 text-slate-300 font-mono text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all resize-none shadow-inner leading-loose"
                        placeholder="contoh:&#10;facebook.com,8.8.8.8,8.8.4.4,1.1.1.1&#10;akamai.com,1.1.1.1@153,9.9.9.9@253"
                     />
                  </div>

                  {/* Parent Resolver */}
                  <div className="w-full lg:w-[450px] flex flex-col gap-2 border-t lg:border-t-0 lg:border-l border-slate-800 pt-6 lg:pt-0 lg:pl-10">
                     <label className="block text-sm font-bold text-white tracking-widest uppercase flex items-center gap-2">
                        Parent Resolver
                     </label>
                     <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                        Format: <code className="text-indigo-300 bg-indigo-900/30 px-1 py-0.5 rounded">ip_resolver</code> atau <code className="text-indigo-300 bg-indigo-900/30 px-1 py-0.5 rounded">ip_resolver@port</code><br/>
                        Berlaku sebagai jaring tangkap utama (Global DNS Forwarder).
                     </p>
                     <div className="space-y-4 mt-1">
                        {[0, 1, 2, 3, 4, 5].map(i => (
                           <div key={i} className="flex items-center gap-4 bg-slate-900/50 p-2 rounded-lg border border-slate-800/80 hover:border-slate-700 transition-colors">
                              <span className="text-slate-400 text-sm font-medium w-24 tracking-wide">Resolver {i+1} :</span>
                              <input 
                                 type="text"
                                 value={parentResolvers[i] || ''}
                                 onChange={(e) => {
                                    const next = [...parentResolvers];
                                    next[i] = e.target.value;
                                    setParentResolvers(next);
                                 }}
                                 className="flex-1 bg-[#0b1120] border border-slate-700/50 rounded-md px-4 py-2 text-indigo-100 font-mono text-sm focus:outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/30 transition-all placeholder:text-slate-700"
                                 placeholder={i === 0 ? "1.2.3.4" : i === 1 ? "2.3.4.5@5353" : "::1"}
                              />
                           </div>
                        ))}
                     </div>
                  </div>

                </div>
              </div>
              </>
              )}

              {/* === TAB: SECURITY OPTIONS === */}
              {adminTab === 'options' && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden lg:col-span-3 pb-4 shadow-lg">
                  <div className="p-6 border-b border-slate-800">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-white">
                      <Server className="w-6 h-6 text-amber-500" /> Operasi DNS Lanjutan
                    </h2>
                    <p className="text-slate-400 text-sm mt-3">Konfigurasikan perilaku protokol tingkat-dalam (deep-layer), termasuk keamanan kriptografi huluan dan skenario perutean paksa.</p>
                  </div>
                  <div className="p-6 space-y-6 flex-1 bg-slate-950/30">
                    
                    {/* SafeSearch */}
                    <div className="flex items-start gap-4 p-4 rounded-lg border border-slate-800/50 bg-[#0b1120]">
                      <div className="pt-1">
                        <input type="checkbox" id="safesearch" checked={safeSearch} onChange={(e) => setSafeSearch(e.target.checked)} className="w-5 h-5 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-900 cursor-pointer accent-amber-500" />
                      </div>
                      <div>
                        <label htmlFor="safesearch" className="text-white font-semibold cursor-pointer text-base">Pemaksaan SafeSearch (Enforce)</label>
                        <p className="text-slate-400 text-sm mt-1 leading-relaxed">Aktifkan pemaksaan (Forced) safesearch pada Google, Bing, Yandex, dan Duckduckgo via injeksi resolusi CNAME RPZ secara otomatis.</p>
                      </div>
                    </div>

                    {/* Tproxy */}
                    <div className="flex items-start gap-4 p-4 rounded-lg border border-slate-800/50 bg-[#0b1120]">
                      <div className="pt-1">
                        <input type="checkbox" id="tproxy" checked={tproxy} onChange={(e) => setTproxy(e.target.checked)} className="w-5 h-5 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-900 cursor-pointer accent-emerald-500" />
                      </div>
                      <div>
                        <label htmlFor="tproxy" className="text-white font-semibold cursor-pointer text-base">Dukungan Tproxy (Transparan)</label>
                        <p className="text-slate-400 text-sm mt-1 leading-relaxed">Menerima kueri Transparent DNS Server pada TCP/UDP port 53. Server DNS ini secara bawaan dapat melayani intersepsi lalu lintas dari NAT/Firewall (Mikrotik).</p>
                      </div>
                    </div>

                    {/* DNSSEC */}
                    <div className="flex items-start gap-4 p-4 rounded-lg border border-slate-800/50 bg-[#0b1120]">
                      <div className="pt-1">
                        <input type="checkbox" id="dnssec" checked={dnssec} onChange={(e) => setDnssec(e.target.checked)} className="w-5 h-5 rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-rose-500 focus:ring-offset-slate-900 cursor-pointer accent-rose-500" />
                      </div>
                      <div>
                        <label htmlFor="dnssec" className="text-white font-semibold cursor-pointer text-base">Validasi Strict DNSSEC</label>
                        <p className="text-slate-400 text-sm mt-1 leading-relaxed">Aktifkan validasi tanda tangan kriptografi tegar (zona BOGUS akan dibuang/drop). Peringatan: Akses diblokir seketika jika sertifikat otentikasi domain kedaluwarsa.</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end px-6">
                    <button onClick={saveAdvancedConfig} className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold tracking-wide rounded-lg shadow-[0_0_15px_rgba(217,119,6,0.3)] transition-colors cursor-pointer flex items-center gap-2">
                       Terapkan Pengaturan
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const DatabaseIcon = ({className}) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>;

export default App;
