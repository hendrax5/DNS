const fs = require('fs');

const appFile = 'src/App.jsx';
let content = fs.readFileSync(appFile, 'utf8');

// Update imports
if(!content.includes('PieChart')) {
  content = content.replace(
    "import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';",
    "import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';"
  );
}

const startMarker = "        {activeTab === 'dashboard' ? (";
const endMarker = "        ) : activeTab === 'admin' && isAuthenticated ? (";

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error("Markers not found!");
  process.exit(1);
}

const newDashboardUI = fs.readFileSync('new_dashboard.txt', 'utf8');

content = content.substring(0, startIndex) + newDashboardUI + "\n" + content.substring(endIndex);
fs.writeFileSync(appFile, content);
console.log('App.jsx dashboard overhauled completely.');
