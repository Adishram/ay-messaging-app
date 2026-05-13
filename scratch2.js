const Hyperswarm = require('hyperswarm');
const crypto = require('crypto');
async function run() {
  const s1 = new Hyperswarm();
  const s2 = new Hyperswarm();
  s1.on('connection', () => console.log('s1 connected'));
  s2.on('connection', () => console.log('s2 connected'));
  
  const topic = crypto.createHash('sha256').update('test-topic-123').digest();
  
  const discovery1 = s1.join(topic, { server: true, client: false });
  await discovery1.flushed();
  console.log('s1 flushed');
  
  const discovery2 = s2.join(topic, { server: false, client: true });
  await discovery2.flushed();
  console.log('s2 flushed');
  
  setTimeout(() => process.exit(0), 3000);
}
run();
