import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = ['package.json', 'MIGRATION_STATUS.md', 'README.md'];
const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(file)) failures.push(`missing: ${file}`);
}

if (existsSync('package.json')) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (pkg.name !== 'department-registration-backend') failures.push('package.name mismatch');
  if (!pkg.scripts?.validate) failures.push('validate script missing');
}

if (failures.length) {
  console.error('BACKEND_BOOTSTRAP_VALIDATION_FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('BACKEND_BOOTSTRAP_VALIDATION_PASS');
