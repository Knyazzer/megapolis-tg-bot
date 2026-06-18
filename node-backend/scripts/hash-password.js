import bcrypt from 'bcryptjs';

const password = process.argv[2] || '';

if (!password) {
  console.error('Usage: npm run hash-password -- "your-password"');
  process.exit(1);
}

console.log(bcrypt.hashSync(password, 12).replace(/^\$2b\$/, '$2y$'));
