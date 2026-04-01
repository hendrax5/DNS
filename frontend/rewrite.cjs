const fs = require('fs');
let content = fs.readFileSync('src/App.jsx', 'utf8');

// 1. Add new icons
content = content.replace(/HardDrive\r?\n\} from 'lucide-react';/, "HardDrive,\n  LogIn,\n  LogOut,\n  Database,\n  KeyRound,\n  LockOpen\n} from 'lucide-react';");

const stateInsertion = `  const [activeTab, setActiveTab] = useState('dashboard');
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
    if (token) headers['Authorization'] = \`Bearer \${token}\`;
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      handleLogout();
    }
    return res;
  };

`;

content = content.replace(/const \[activeTab, setActiveTab\] = useState\('dashboard'\);\r?\n\s+const \[adminTab, setAdminTab\] = useState\('threats'\);/, stateInsertion);

// 3. Update useEffect for loadSettings
content = content.replace(/useEffect\(\(\) => \{\r?\n\s+if \(activeTab === 'admin'\) loadSettings\(\);\r?\n\s+\}, \[activeTab\]\);/, `useEffect(() => {
    if (activeTab === 'admin' && isAuthenticated) {
      loadSettings();
    }
  }, [activeTab, isAuthenticated]);`);

// 4. Update the menu to have Logout button
const navBar = `          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            {isAuthenticated && (
              <button onClick={handleLogout} className="px-3 py-1.5 text-slate-400 hover:text-red-400 transition-colors text-sm font-medium mr-2">
                <LogOut className="w-4 h-4 inline-block" />
              </button>
            )}`;

content = content.replace('<div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">', navBar);

// 5. Replace standard fetch with apiFetch for protected endpoints
content = content.replace(/fetch\('\/api\/laman-labuh/g, "apiFetch('/api/laman-labuh");
content = content.replace(/fetch\('\/api\/acl/g, "apiFetch('/api/acl");
content = content.replace(/fetch\('\/api\/rpz-feeds/g, "apiFetch('/api/rpz-feeds");
content = content.replace(/fetch\('\/api\/custom-lists/g, "apiFetch('/api/custom-lists");
content = content.replace(/fetch\('\/api\/rpz-axfr/g, "apiFetch('/api/rpz-axfr");
content = content.replace(/fetch\('\/api\/forwarders/g, "apiFetch('/api/forwarders");
content = content.replace(/fetch\('\/api\/advanced-config/g, "apiFetch('/api/advanced-config");
content = content.replace(/fetch\('\/api\/search-rpz/g, "apiFetch('/api/search-rpz");

// 6. Login Gate Logic
const loginUI = `        {activeTab === 'admin' && !isAuthenticated && (
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

        {activeTab === 'dashboard' ? (`;

content = content.replace("{activeTab === 'dashboard' ? (", loginUI);

const guardedAdminContent = `        ) : activeTab === 'admin' && isAuthenticated ? (
          <div className="space-y-6 flex flex-col h-full">
            <div className="flex items-center gap-3 bg-indigo-500/10 border border-indigo-500/20 px-4 py-2 rounded-lg text-indigo-300 w-max mb-2 shadow-inner">
               <LockOpen className="w-4 h-4" /> 
               <span className="text-sm font-medium">Sesi Aktif: {loginEmail || 'Admin NetShield'}</span>
            </div>
`;

content = content.replace(/        \) : \(\r?\n          <div className="space-y-6 flex flex-col h-full">/, guardedAdminContent);

fs.writeFileSync('src/App.jsx', content);
console.log('App.jsx modified successfully!');
