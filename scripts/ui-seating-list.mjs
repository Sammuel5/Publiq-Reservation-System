import assert from 'node:assert/strict';
import { chromium, webkit, devices } from 'playwright';
const base=process.env.TEST_BASE_URL??'http://127.0.0.1:3000';
const mapping={'VIP 1':7,'VIP 2':8,'VIP 3':9,'VIP 4':9,'VIP 5':1,'VIP 6':2,'VIP 7':3};
for(const [engine,name,device] of [[chromium,'desktop',{}],[webkit,'iPhone SE',devices['iPhone SE']],[chromium,'Pixel 5',devices['Pixel 5']]]) {
 const b=await engine.launch(), c=await b.newContext(device), p=await c.newPage();
 try {
  assert.equal((await p.goto(`${base}/spaces`)).status(),200);
  for(const [label,image] of Object.entries(mapping)) {
   const card=p.locator('article').filter({has:p.getByRole('heading',{name:label,exact:true})});
   assert.equal(await card.count(),1);assert.match(await card.locator('img').first().getAttribute('src'),new RegExp(`venue-${image}\\.jpeg$`));
   assert.equal((await c.request.get(`${base}/images/publiq-venue/venue-${image}.jpeg`)).status(),200);
  }
  for(const number of [2,3,4,5,6])assert.equal(await p.getByRole('heading',{name:`Couch ${number}`,exact:true}).count(),1);
  assert.match(await p.locator('#vip').innerText(),/VIP 3 and VIP 4 can also be arranged together/);
  assert.match(await p.locator('main').innerText(),/not yet available online/i);
  for(const tier of ['₱7,000','₱8,500','₱10,000'])assert.ok((await p.locator('#vip').innerText()).includes(tier));
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  console.log(`✓ ${name}: all 12 spaces, VIP images, combined note, tiers and mobile width`);
 } finally {await c.close();await b.close()}
}
