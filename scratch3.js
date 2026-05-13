const Hyperswarm = require('hyperswarm');
async function run() {
  const s1 = new Hyperswarm();
  const s2 = new Hyperswarm();
  s1.on('connection', () => console.log('s1 connected'));
  s2.on('connection', () => console.log('s2 connected'));
  
  await s1.listen();
  console.log('s1 listening on', s1.keyPair.publicKey.toString('hex'));
  
  s2.joinPeer(s1.keyPair.publicKey);
  console.log('s2 joining peer');
  
  setTimeout(() => process.exit(0), 3000);
}
run();
