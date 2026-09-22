const fs = require('fs');
const content = fs.readFileSync('src/adapters/store/schema.ts', 'utf8');
const fixed = content.replace('  UNIQUE (work_order_id, repo, pointer)\n);\n`;', '  UNIQUE (work_order_id, repo, pointer)\n);\n`;');
fs.writeFileSync('src/adapters/store/schema.ts', content + '`;\n'); // Wait, let's just append the backtick where it belongs!
