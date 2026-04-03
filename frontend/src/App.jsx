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
  HardDrive,
  LogIn,
  LogOut,
  Database,
  KeyRound,
  LockOpen,
  Plus,
  Trash2,
  ShieldBan
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import Zones from './pages/Zones';

function App() {
    const [activeTab, setActiveTab] = useState('dashboard');
  const [adminTab, setAdminTab] = useState('threats');

  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('jwtToken'));
  const [jwtToken, setJwtToken] = useState(localStorage.getItem('jwtToken') || '');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const handleLogout = () => {
    setIsAuthenticated(false);
    setJwtToken('');
    localStorage.removeItem('jwtToken');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email: loginEmail, password: loginPassword})
      });
      const data = await res.json();
      if (res.ok) {
        setJwtToken(data.token);
        localStorage.setItem('jwtToken', data.token);
        setIsAuthenticated(true);
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch(err) {
      setLoginError('Server terputus');
    }
  };

  const apiFetch = async (url, options = {}) => {
    const headers = { ...options.headers };
    const token = localStorage.getItem('jwtToken');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      handleLogout();
    }
    return res;
  };


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
  const [topAnalytics, setTopAnalytics] = useState({ clients: [], allowed: [], blocked: [] });
  const [digHealth, setDigHealth] = useState([]);
  const [digTargetsText, setDigTargetsText] = useState("");

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
    if (activeTab === 'dashboard') {
      const fetchTop = async () => {
        try {
          const res = await fetch('/api/top-analytics');
          const data = await res.json();
          setTopAnalytics({
            clients: (data.top_clients || []).sort((a,b)=>(b.allow+b.block)-(a.allow+a.block)).slice(0, 5),
            allowed: (data.top_allowed_domains || []).sort((a,b)=>b.count-a.count).slice(0, 5),
            blocked: (data.top_blocked_domains || []).sort((a,b)=>b.count-a.count).slice(0, 10)
          });
        } catch(e) {}
      };
      
      const fetchDigHealth = async () => {
          try {
              const res = await fetch('/api/dig-health');
              const data = await res.json();
              if(data.health) {
                  setDigHealth(data.health);
              }
          } catch(e) {}
      }

      fetchTop();
      fetchDigHealth();
      const iv = setInterval(fetchTop, 5000);
      const ivDig = setInterval(fetchDigHealth, 3000);
      return () => { clearInterval(iv); clearInterval(ivDig); }
    }
  }, [activeTab]);

  const loadSettings = async () => {
    try {
      const resLL = await apiFetch('/api/laman-labuh');
      const dataLL = await resLL.json();
      if(dataLL.ips) setLamanLabuh(dataLL.ips.filter(Boolean));

      const resACL = await apiFetch('/api/acl');
      const dataACL = await resACL.json();
      if(dataACL.ips) setAclList(dataACL.ips.filter(Boolean));

      const resRPZ = await apiFetch('/api/rpz-feeds');
      const dataRPZ = await resRPZ.json();
      if(dataRPZ.feeds) setRpzFeeds(dataRPZ.feeds);
      if(dataRPZ.sync_interval) setSyncInterval(dataRPZ.sync_interval);

      const resCustom = await apiFetch('/api/custom-lists');
      const dataCustom = await resCustom.json();
      if(dataCustom.blacklist) setCustomBlacklist(dataCustom.blacklist);
      if(dataCustom.whitelist) setCustomWhitelist(dataCustom.whitelist);

      const resAXFR = await apiFetch('/api/rpz-axfr');
      const dataAXFR = await resAXFR.json();
      if(dataAXFR.feeds) setRpzAXFR(dataAXFR.feeds);

      const resFwd = await apiFetch('/api/forwarders');
      const dataFwd = await resFwd.json();
      if(dataFwd.domain_forwarders !== undefined) setDomainForwarders(dataFwd.domain_forwarders);
      if(dataFwd.parent_resolvers) setParentResolvers(dataFwd.parent_resolvers);

      const resAdv = await apiFetch('/api/advanced-config');
      const dataAdv = await resAdv.json();
      if(dataAdv.safesearch !== undefined) setSafeSearch(dataAdv.safesearch);
      if(dataAdv.dnssec !== undefined) setDnssec(dataAdv.dnssec);

      const resDig = await apiFetch('/api/dig-targets');
      const dataDig = await resDig.json();
      if(dataDig.targets) {
          setDigTargetsText(dataDig.targets.map(t=>t.domain).join('\n'));
      }
    } catch(e) { console.error(e) }
  };

  useEffect(() => {
    if (activeTab === 'admin' && isAuthenticated) {
      loadSettings();
    }
  }, [activeTab, isAuthenticated]);

  const showNotification = (message, type = 'success') => {
    setSaveStatus({ show: true, message, type });
    setTimeout(() => setSaveStatus({ show: false, message: '', type: '' }), 3000);
  };

  const saveLamanLabuh = async () => {
    try {
      const ips = lamanLabuh.map(i=>i.trim()).filter(i=>i);
      await apiFetch('/api/laman-labuh', {
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
      await apiFetch('/api/acl', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ips})
      });
      showNotification('Access Control List (ACL) enforced');
    } catch(e) { showNotification('Failed to update ACL', 'error'); }
  };

  const saveAdvancedConfig = async () => {
    try {
      await apiFetch('/api/advanced-config', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({safesearch: safeSearch, dnssec})
      });

      const ips = digTargetsText.split('\n').map(d=>d.trim()).filter(d=>d);
      await apiFetch('/api/dig-targets', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({targets: ips.map(domain => ({domain}))})
      });

      showNotification('Advanced Security Settings & Dig Targets Applied!');
    } catch(e) { showNotification('Failed to save settings', 'error'); }
  };

  const saveRPZ = async () => {
    try {
      await apiFetch('/api/rpz-feeds', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ feeds: rpzFeeds.filter(f => f.url.trim()), sync_interval: syncInterval })
      });
      showNotification('RPZ Feeds scheduled for sync');
    } catch(e) { showNotification('Failed to update RPZ', 'error'); }
  };

  const saveCustomLists = async () => {
    try {
      await apiFetch('/api/custom-lists', {
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
      const res = await apiFetch('/api/search-rpz?q=' + encodeURIComponent(searchRpzQuery));
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
      await apiFetch('/api/rpz-axfr', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ feeds: rpzAXFR.filter(f => f.master_ip.trim() && f.zone_name.trim()) })
      });
      showNotification('Native Zone IXFR Configured Successfully');
    } catch(e) { showNotification('Failed to update AXFR Masters', 'error'); }
  };

  const saveForwarders = async () => {
    try {
      await apiFetch('/api/forwarders', {
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
            <div className="flex flex-col justify-center">
              <span className="text-xl font-bold tracking-tight text-white leading-none">NetShield<span className="text-slate-400 font-medium">Enterprise</span></span>
              <span className="text-[10px] text-emerald-400 font-semibold tracking-wide uppercase mt-0.5">supported by ServiceX</span>
            </div>
          </div>
          
                    <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            {isAuthenticated && (
              <button onClick={handleLogout} className="px-3 py-1.5 text-slate-400 hover:text-red-400 transition-colors text-sm font-medium mr-2">
                <LogOut className="w-4 h-4 inline-block" />
              </button>
            )}
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
        
                {activeTab === 'admin' && !isAuthenticated && (
          <div className="flex items-center justify-center min-h-[70vh]">
            <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl w-full max-w-md shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-indigo-500"></div>
              <div className="text-center mb-8">
                <div className="bg-slate-950 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-slate-800 shadow-inner">
                  <KeyRound className="w-8 h-8 text-indigo-400" />
                </div>
                <h1 className="text-2xl font-bold text-white tracking-tight">Otorisasi Keamanan</h1>
                <p className="text-slate-400 text-sm mt-2">Silakan login untuk mengakses Security Profile.</p>
              </div>

              {loginError && (
                <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-red-400 text-sm">
                  <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <p>{loginError}</p>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Email Admin</label>
                  <input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} required placeholder="admin@domain.com" className="w-full bg-[#0b1120] border border-slate-700/50 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Kata Sandi</label>
                  <input type="password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} required placeholder="••••••••" className="w-full bg-[#0b1120] border border-slate-700/50 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
                </div>
                <button type="submit" className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-colors shadow-[0_0_15px_rgba(79,70,229,0.3)] mt-4">
                  Buka Kunci (Login)
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'dashboard' ? (
          <div className="space-y-6 flex flex-col h-full animate-fadeIn transition-all">
            {/* Header Dashboard dihilangkan untuk memberi ruang Dashboard rapat / dense */}
            
            {/* Row 1: KPI Tiles */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col items-center justify-center relative overflow-hidden group hover:border-blue-500/50 transition">
                <div className="absolute -inset-0 bg-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity blur-xl pointer-events-none"></div>
                <Globe className="w-5 h-5 text-blue-400 mb-2" />
                <span className="text-3xl font-bold text-white tracking-tight">{stats?.qps?.toLocaleString() || 0}</span>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Total Query / Sec</span>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col items-center justify-center relative overflow-hidden group hover:border-indigo-500/50 transition">
                <div className="absolute -inset-0 bg-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity blur-xl pointer-events-none"></div>
                <Activity className="w-5 h-5 text-indigo-400 mb-2" />
                <span className="text-3xl font-bold text-white tracking-tight">{stats?.avg_latency_ms || 0}</span>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Avg Response ms</span>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col items-center justify-center relative overflow-hidden group hover:border-emerald-500/50 transition">
                <div className="absolute -inset-0 bg-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity blur-xl pointer-events-none"></div>
                <Database className="w-5 h-5 text-emerald-400 mb-2" />
                <span className="text-3xl font-bold text-white tracking-tight">{stats?.cache_hit_ratio || 0}<span className="text-lg text-slate-400 ml-1">%</span></span>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Cache hit ratio</span>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col items-center justify-center relative overflow-hidden group hover:border-rose-500/50 transition">
                <div className="absolute -inset-0 bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-opacity blur-xl pointer-events-none"></div>
                <ShieldBan className="w-5 h-5 text-rose-500 mb-2" />
                <span className="text-3xl font-bold text-rose-400 tracking-tight">{(topAnalytics.blocked.reduce((sum, item) => sum + item.count, 0)).toLocaleString()}</span>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">Threats Blocked</span>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col items-center justify-center relative overflow-hidden group hover:border-amber-500/50 transition">
                <div className="absolute -inset-0 bg-amber-500/10 opacity-0 group-hover:opacity-100 transition-opacity blur-xl pointer-events-none"></div>
                <Cpu className="w-5 h-5 text-amber-500 mb-2" />
                <span className="text-3xl font-bold text-white tracking-tight">{stats?.cpu_usage || 0}<span className="text-lg text-slate-400 ml-1">%</span></span>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">{stats?.mem_usage_mb || 0} MB RAM</span>
              </div>
            </div>

            {/* Row 2: Time Series */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col shadow-lg">
                <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-2"><BarChart2 className="w-4 h-4 text-blue-400" /> Query Volume (QPS)</span>
                  <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded">Harian/Mingguan</span>
                </h3>
                <div className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats?.history_series || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorQpsV3" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="time" stroke="#475569" tick={{fill: '#64748b', fontSize: 11}} axisLine={false} tickLine={false} />
                      <YAxis stroke="#475569" tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc', fontSize: '13px'}} cursor={{stroke: '#334155', strokeWidth: 1}} />
                      <Area type="monotone" name="QPS" dataKey="qps" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorQpsV3)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col shadow-lg">
                <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-2"><Activity className="w-4 h-4 text-indigo-400" /> Latency & Efficiency</span>
                </h3>
                <div className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats?.history_series || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorLat" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="time" stroke="#475569" tick={{fill: '#64748b', fontSize: 11}} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="left" stroke="#818cf8" tick={{fill: '#818cf8', fontSize: 12}} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="right" orientation="right" stroke="#34d399" tick={{fill: '#34d399', fontSize: 12}} axisLine={false} tickLine={false} domain={[0,100]} />
                      <Tooltip contentStyle={{backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc', fontSize: '13px'}} cursor={{stroke: '#334155', strokeWidth: 1}}/>
                      <Area yAxisId="left" type="monotone" name="Latency (ms)" dataKey="latency" stroke="#818cf8" strokeWidth={2} fillOpacity={1} fill="url(#colorLat)" isAnimationActive={false} />
                      <Area yAxisId="right" type="monotone" name="Cache Ratio (%)" dataKey="cacheRatio" stroke="#34d399" strokeDasharray="4 4" fill="none" strokeWidth={2} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Row 3: Distributions & Security Alerts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-lg flex flex-col items-center">
                <h3 className="text-sm font-semibold text-slate-400 mb-2 uppercase tracking-wider w-full flex items-center gap-2">Response Codes</h3>
                <div className="w-full h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={[
                        {name: 'NOERROR', value: stats?.response_codes?.NOERROR || 1},
                        {name: 'NXDOMAIN', value: stats?.response_codes?.NXDOMAIN || 0},
                        {name: 'SERVFAIL', value: stats?.response_codes?.SERVFAIL || 0}
                      ]} cx="50%" cy="45%" innerRadius={60} outerRadius={80} dataKey="value" stroke="none" labelLine={false}>
                        <Cell fill="#10b981" />
                        <Cell fill="#f59e0b" />
                        <Cell fill="#ef4444" />
                      </Pie>
                      <Tooltip contentStyle={{backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '12px'}} itemStyle={{color:'#e2e8f0'}} />
                      <Legend verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{fontSize: '11px', color: '#94a3b8'}} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-lg flex flex-col items-center">
                <h3 className="text-sm font-semibold text-slate-400 mb-2 uppercase tracking-wider w-full flex items-center gap-2">Query Types</h3>
                <div className="w-full h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={Object.entries(stats?.query_types || {'A':1}).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v]) => ({name: k, value: v}))} cx="50%" cy="45%" innerRadius={0} outerRadius={80} dataKey="value" stroke="none" labelLine={false}>
                        {Object.entries(stats?.query_types || {}).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={['#3b82f6', '#8b5cf6', '#0ea5e9', '#ec4899', '#f97316'][index % 5]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '12px'}} itemStyle={{color:'#e2e8f0'}} />
                      <Legend verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{fontSize: '11px', color: '#94a3b8'}} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-lg overflow-hidden flex flex-col h-[300px]">
                <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-rose-500" /> DNS Anomaly Sentinel</span>
                  <span className="text-[10px] bg-rose-500/20 text-rose-400 px-2 py-0.5 rounded border border-rose-500/30 font-bold animate-pulse">LIVE</span>
                </h3>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {stats?.telemetry_alerts?.length > 0 ? stats.telemetry_alerts.map((a, i) => (
                    <div key={i} className={`p-3 rounded-lg border text-xs leading-relaxed ${a.Level === 'CRIT' ? 'bg-rose-500/10 border-rose-500/30 text-rose-200' : 'bg-amber-500/10 border-amber-500/30 text-amber-200'}`}>
                       <div className="mb-1 flex justify-between items-center">
                          <span className={`font-bold ${a.Level === 'CRIT' ? 'text-rose-400' : 'text-amber-400'}`}>[{a.Level}] ALARM</span>
                          <span className="opacity-70 font-mono text-[10px]">{a.Time}</span>
                       </div>
                       <p className="opacity-90">{a.Message}</p>
                    </div>
                  )) : (
                    <div className="flex h-full flex-col items-center justify-center text-slate-500 space-y-2 opacity-50">
                       <ShieldCheck className="w-8 h-8 text-emerald-500" />
                       <span className="text-xs font-medium">No Anomalies Detected. Network Secure.</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Row 4: Custom Dig Monitor & Subnets */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12">
             <div className="bg-[#0f172a] shadow-lg border border-slate-800 p-6 rounded-xl flex flex-col h-full">
               <h3 className="text-sm font-semibold text-slate-400 mb-1 uppercase tracking-wider flex items-center gap-2">
                 <Globe className="w-4 h-4 text-indigo-400" />
                 Upstream Health Monitor
               </h3>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                   {digHealth.map((d, i) => (
                       <div key={i} className="flex flex-col bg-[#0b1120] border border-slate-800 p-4 rounded-xl relative overflow-hidden group hover:border-slate-700 transition">
                           <div className={`absolute top-0 right-0 w-16 h-16 blur-2xl opacity-10 ${d.status === 'OK' ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
                           <span className="text-xs text-slate-400 mb-1 truncate">{d.domain}</span>
                           <div className="flex items-end gap-2">
                              <span className={`text-3xl font-bold font-mono tracking-tight ${d.status === 'OK' ? 'text-white' : 'text-rose-400'}`}>
                                  {d.status === 'OK' ? d.latency : 'ERR'}
                              </span>
                              <span className="text-slate-500 text-sm font-semibold mb-1">ms</span>
                           </div>
                           <div className="mt-3 flex items-center gap-1.5">
                               <span className="relative flex h-2 w-2">
                                  <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${d.status === 'OK' ? 'animate-ping bg-emerald-400' : 'bg-rose-500'}`}></span>
                                  <span className={`relative inline-flex rounded-full h-2 w-2 ${d.status === 'OK' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                               </span>
                               <span className={`text-[10px] font-bold tracking-wider uppercase ${d.status === 'OK' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                   {d.status === 'OK' ? 'RESOLVED' : 'TIMEOUT'}
                               </span>
                           </div>
                       </div>
                   ))}
                   {digHealth.length === 0 && <span className="text-slate-500 text-sm italic col-span-2 text-center p-6 border border-dashed border-slate-800 rounded-lg">Monitoring target...</span>}
               </div>
             </div>

             <div className="flex flex-col gap-6">
               <div className="bg-[#0f172a] border border-slate-800 p-6 rounded-xl shadow-lg">
                 <h3 className="text-sm font-semibold text-slate-400 mb-4 uppercase tracking-wider">Top Access Blocked (Global Lists)</h3>
                 <div className="space-y-3">
                   {topAnalytics.blocked.map((d, i) => (
                     <div key={i} className="flex justify-between items-center px-4 py-2 bg-[#0b1120] rounded-lg border border-rose-900/30 hover:border-rose-800/50">
                       <span className="text-rose-100 text-xs truncate pr-2 font-mono flex items-center gap-3"><span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>{d.name}</span>
                       <span className="text-rose-400 font-bold bg-rose-500/10 px-2.5 py-1 rounded-md text-xs border border-rose-500/20">{d.count.toLocaleString()} x</span>
                     </div>
                   ))}
                   {topAnalytics.blocked.length === 0 && <span className="text-slate-500 text-sm">No threats blocked...</span>}
                 </div>
               </div>
             </div>
            </div>
          </div>

        ) : activeTab === 'admin' && isAuthenticated ? (
          <div className="space-y-6 flex flex-col h-full">
            <div className="flex items-center gap-3 bg-indigo-500/10 border border-indigo-500/20 px-4 py-2 rounded-lg text-indigo-300 w-max mb-2 shadow-inner">
               <LockOpen className="w-4 h-4" /> 
               <span className="text-sm font-medium">Sesi Aktif: {loginEmail || 'Admin NetShield'}</span>
            </div>

            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Kebijakan Keamanan</h1>
              <p className="text-slate-400 text-sm mt-1">Kelola perutean intelijen ancaman, akses jaringan, dan kepatuhan keamanan.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-4">
              <button onClick={() => setAdminTab('threats')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${adminTab === 'threats' ? 'bg-fuchsia-600 text-white shadow-[0_0_15px_rgba(192,38,211,0.3)]' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}><ShieldAlert className="w-4 h-4 inline-block mr-2" />Intelijen Ancaman & RPZ</button>
              <button onClick={() => setAdminTab('forwarding')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${adminTab === 'forwarding' ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.3)]' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}><Globe className="w-4 h-4 inline-block mr-2" />Penerusan Global</button>
              <button onClick={() => setAdminTab('zones')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${adminTab === 'zones' ? 'bg-cyan-600 text-white shadow-[0_0_15px_rgba(8,145,178,0.3)]' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}><Database className="w-4 h-4 inline-block mr-2" />Local/Auth Zones</button>
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

              {/* === TAB: ZONES === */}
              {adminTab === 'zones' && (
                <div className="lg:col-span-3">
                  <Zones apiFetch={apiFetch} setSaveStatus={setSaveStatus} />
                </div>
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
              <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden lg:col-span-2 shadow-xl">
                <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-800/20">
                  <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                      <ShieldCheck className="w-6 h-6 text-emerald-400" />
                      Pengecualian Aturan Khusus (Bypass)
                    </h2>
                    <p className="text-slate-400 text-sm mt-2 leading-relaxed max-w-2xl">
                      Berikan intervensi manual pada rute penyelesaian DNS. Domain pada <strong className="text-emerald-400 font-semibold">Daftar Diizinkan</strong> terbebas dari seluruh blokir, sementara <strong className="text-rose-400 font-semibold">Daftar Blokir</strong> akan ditolak seketika secara absolut (NXDOMAIN). 
                    </p>
                  </div>
                  <button 
                    onClick={saveCustomLists}
                    className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all duration-300 cursor-pointer flex items-center gap-3 transform hover:scale-105"
                  >
                    <RefreshCw className="w-4 h-4" /> Kompilasi Aturan Kustom
                  </button>
                </div>
                
                <div className="p-0 bg-slate-950/30 flex flex-col xl:flex-row flex-1">
                  
                  {/* ====== WHITELIST PANEL ====== */}
                  <div className="flex-1 flex flex-col border-b xl:border-b-0 xl:border-r border-slate-800/80">
                     <div className="p-6 bg-emerald-900/10 border-b border-emerald-900/20 flex justify-between items-center">
                       <div>
                         <label className="block text-sm font-bold text-emerald-400 tracking-widest uppercase flex items-center gap-2">
                            <CheckCircle2 className="w-5 h-5" /> Daftar Diizinkan (Whitelist)
                         </label>
                         <p className="text-xs text-slate-500 mt-1">Total {customWhitelist.length} domain dikecualikan.</p>
                       </div>
                       <div className="bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-full text-xs font-bold border border-emerald-500/20">
                         ALLOW
                       </div>
                     </div>
                     
                     <div className="p-6 flex-1 flex flex-col gap-4">
                       <div className="flex gap-2">
                         <div className="relative flex-1">
                           <Globe className="w-4 h-4 absolute left-3 top-3 text-emerald-500/50" />
                           <input 
                              type="text" 
                              id="inputWhitelistAdd"
                              onKeyDown={e => {
                                if(e.key === 'Enter') {
                                  const val = e.target.value.trim();
                                  if(!val) return;
                                  if(!customWhitelist.includes(val)) setCustomWhitelist([val, ...customWhitelist]);
                                  e.target.value = '';
                                }
                              }}
                              placeholder="Tambah domain (tekan enter)..."
                              className="w-full bg-[#0b1120] border border-emerald-900/50 rounded-lg pl-10 pr-4 py-2.5 text-sm font-mono text-emerald-100 focus:outline-none focus:border-emerald-500/50 transition-colors shadow-inner placeholder:text-slate-600"
                           />
                         </div>
                         <button 
                            onClick={() => {
                              const input = document.getElementById('inputWhitelistAdd');
                              const val = input.value.trim();
                              if(!val) return;
                              if(!customWhitelist.includes(val)) setCustomWhitelist([val, ...customWhitelist]);
                              input.value = '';
                            }}
                            className="bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 p-2.5 rounded-lg border border-emerald-500/30 transition-colors cursor-pointer flex-shrink-0"
                         >
                           <Plus className="w-5 h-5" />
                         </button>
                       </div>

                       <div className="flex flex-col gap-2 max-h-96 min-h-[12rem] overflow-y-auto pr-2 custom-scrollbar">
                          {customWhitelist.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center py-10 border border-dashed border-emerald-900/50 rounded-xl bg-emerald-900/5">
                              <CheckCircle2 className="w-8 h-8 text-emerald-700/50 mx-auto mb-3" />
                              <p className="text-sm font-medium text-emerald-600/70">Daftar masih kosong</p>
                              <p className="text-xs text-slate-600 mt-1">Gunakan kotak input di atas</p>
                            </div>
                          ) : (
                            customWhitelist.map((domain, i) => (
                               <div key={i} className="flex justify-between items-center group bg-[#0b1120] border border-emerald-900/20 p-3 rounded-xl hover:border-emerald-500/40 transition-all hover:shadow-lg hover:shadow-emerald-900/20">
                                  <div className="flex items-center gap-3 overflow-hidden flex-1">
                                     <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0"></div>
                                     <input 
                                        type="text" 
                                        value={domain}
                                        onChange={e => {
                                           const next = [...customWhitelist];
                                           next[i] = e.target.value;
                                           setCustomWhitelist(next);
                                        }}
                                        className="bg-transparent text-emerald-50 font-mono text-sm focus:outline-none w-full truncate"
                                     />
                                  </div>
                                  <button onClick={() => setCustomWhitelist(customWhitelist.filter((_, idx)=>idx!==i))} className="text-slate-600 hover:text-rose-400 p-2 rounded-lg hover:bg-rose-500/10 cursor-pointer transition-colors opacity-50 group-hover:opacity-100 flex-shrink-0">
                                     <Trash2 className="w-4 h-4" />
                                  </button>
                               </div>
                            ))
                          )}
                       </div>
                     </div>
                  </div>

                  {/* ====== BLACKLIST PANEL ====== */}
                  <div className="flex-1 flex flex-col">
                     <div className="p-6 bg-rose-900/10 border-b border-rose-900/20 flex justify-between items-center">
                       <div>
                         <label className="block text-sm font-bold text-rose-500 tracking-widest uppercase flex items-center gap-2">
                            <ShieldBan className="w-5 h-5" /> Daftar Blokir (Blacklist)
                         </label>
                         <p className="text-xs text-slate-500 mt-1">Total {customBlacklist.length} domain dicekal mutlak.</p>
                       </div>
                       <div className="bg-rose-500/10 text-rose-400 px-3 py-1 rounded-full text-xs font-bold border border-rose-500/20">
                         DROP / NXDOMAIN
                       </div>
                     </div>
                     
                     <div className="p-6 flex-1 flex flex-col gap-4">
                       <div className="flex gap-2">
                         <div className="relative flex-1">
                           <Globe className="w-4 h-4 absolute left-3 top-3 text-rose-500/50" />
                           <input 
                              type="text" 
                              id="inputBlacklistAdd"
                              onKeyDown={e => {
                                if(e.key === 'Enter') {
                                  const val = e.target.value.trim();
                                  if(!val) return;
                                  if(!customBlacklist.includes(val)) setCustomBlacklist([val, ...customBlacklist]);
                                  e.target.value = '';
                                }
                              }}
                              placeholder="Tambah blokir (tekan enter)..."
                              className="w-full bg-[#0b1120] border border-rose-900/50 rounded-lg pl-10 pr-4 py-2.5 text-sm font-mono text-rose-100 focus:outline-none focus:border-rose-500/50 transition-colors shadow-inner placeholder:text-slate-600"
                           />
                         </div>
                         <button 
                            onClick={() => {
                              const input = document.getElementById('inputBlacklistAdd');
                              const val = input.value.trim();
                              if(!val) return;
                              if(!customBlacklist.includes(val)) setCustomBlacklist([val, ...customBlacklist]);
                              input.value = '';
                            }}
                            className="bg-rose-600/20 hover:bg-rose-600/40 text-rose-400 p-2.5 rounded-lg border border-rose-500/30 transition-colors cursor-pointer flex-shrink-0"
                         >
                           <Plus className="w-5 h-5" />
                         </button>
                       </div>

                       <div className="flex flex-col gap-2 max-h-96 min-h-[12rem] overflow-y-auto pr-2 custom-scrollbar">
                          {customBlacklist.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center py-10 border border-dashed border-rose-900/50 rounded-xl bg-rose-900/5">
                              <ShieldBan className="w-8 h-8 text-rose-800/50 mx-auto mb-3" />
                              <p className="text-sm font-medium text-rose-600/70">Daftar blokir kosong</p>
                              <p className="text-xs text-slate-600 mt-1">Domain yang dicekal akan tampil di sini</p>
                            </div>
                          ) : (
                            customBlacklist.map((domain, i) => (
                               <div key={i} className="flex justify-between items-center group bg-[#0b1120] border border-rose-900/20 p-3 rounded-xl hover:border-rose-500/40 transition-all hover:shadow-lg hover:shadow-rose-900/20">
                                  <div className="flex items-center gap-3 overflow-hidden flex-1">
                                     <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse flex-shrink-0"></div>
                                     <input 
                                        type="text" 
                                        value={domain}
                                        onChange={e => {
                                           const next = [...customBlacklist];
                                           next[i] = e.target.value;
                                           setCustomBlacklist(next);
                                        }}
                                        className="bg-transparent text-rose-50 font-mono text-sm focus:outline-none w-full truncate"
                                     />
                                  </div>
                                  <button onClick={() => setCustomBlacklist(customBlacklist.filter((_, idx)=>idx!==i))} className="text-slate-600 hover:text-rose-400 p-2 rounded-lg hover:bg-rose-500/10 cursor-pointer transition-colors opacity-50 group-hover:opacity-100 flex-shrink-0">
                                     <Trash2 className="w-4 h-4" />
                                  </button>
                               </div>
                            ))
                          )}
                       </div>
                     </div>
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
                    {/* Custom Dig Monitor Settings */}
                    <div className="flex items-start gap-4 p-4 rounded-lg border border-slate-800/50 bg-[#0b1120]">
                      <div className="pt-1">
                          <Activity className="w-5 h-5 text-indigo-400" />
                      </div>
                      <div className="w-full">
                        <label className="text-white font-semibold text-base mb-1 block">Custom Dig Targets</label>
                        <p className="text-slate-400 text-sm mt-1 mb-3 leading-relaxed">Masukkan domain yang ingin dipantau performa DNS resolusinya di Dasbor secara Real-Time. (Termasuk Ping Upstream Google). Pisahkan dengan enter (baris baru).</p>
                        <textarea
                          value={digTargetsText}
                          onChange={(e) => setDigTargetsText(e.target.value)}
                          className="w-full h-32 bg-slate-900/50 border border-slate-700/50 rounded-lg p-3 text-sm font-mono text-slate-300 resize-none focus:outline-none focus:border-indigo-500"
                          placeholder="google.com&#10;8.8.8.8&#10;server-kantor.id"
                        ></textarea>
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
        ) : null}
      </main>
    </div>
  );
}

const DatabaseIcon = ({className}) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>;

export default App;
