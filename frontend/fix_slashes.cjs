const fs = require('fs');
let code = fs.readFileSync('src/App.jsx', 'utf8');

// The file might contain things like: className={\`p-3 \${foo}\`}
// We want to remove the backslashes before backticks and dollar-braces that shouldn't be escaped in actual JS string
code = code.replace(/\\\`/g, '`');
code = code.replace(/\\\$\{/g, '${');

fs.writeFileSync('src/App.jsx', code);
console.log('Fixed backslashes.');
