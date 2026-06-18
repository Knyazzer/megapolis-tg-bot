import { seedDemoData } from '../src/admin/demo-data.js';

const result = await seedDemoData();
console.log(`Demo data ready: ${result.events} events, ${result.people} people, ${result.registrations} registrations`);
