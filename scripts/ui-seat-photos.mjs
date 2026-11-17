import assert from 'node:assert/strict';
import { chromium, webkit, devices } from 'playwright';
const base=process.env.TEST_BASE_URL??'http://127.0.0.1:3000';
const mapping={'VIP 1':7,'VIP 2':8,'VIP 3':9,'VIP 4':9,'VIP 5':1,'VIP 6':2,'VIP 7':3};
for (const [engine,name,device] of [[chromium,'desktop',{}],[webkit,'iPhone SE',devices['iPhone SE']],[webkit,'iPhone 13 landscape',devices['iPhone 13 landscape']],[chromium,'Pixel 5',devices['Pixel 5']]]) for(const javaScriptEnabled of [true,false]) {
 const browser=await engine.launch(), context=await browser.newContext({...device,javaScriptEnabled}), page=await context.newPage();
 const press=async l=> device.hasTouch ? l.tap() : l.click();
 try {
  await page.goto(`${base}/spaces`,{waitUntil:'load'});
  for(const [label,image] of Object.entries(mapping)) {
   const card=page.locator('article').filter({has:page.getByRole('heading',{name:label,exact:true})});
   const detail=card.locator('details'), trigger=detail.locator('summary');
   await press(trigger); assert.equal(await detail.getAttribute('open'),'');
   const enlarged=detail.locator('div[aria-label$="enlarged photo"]');
   assert.ok(await enlarged.isVisible());
   assert.match(await enlarged.locator('img').getAttribute('src'),new RegExp(`venue-${image}\\.jpeg$`));
   assert.equal(await enlarged.getByRole('link',{name:'Continue to booking'}).getAttribute('href'),`/reserve?seat=${encodeURIComponent(label)}`);
   await press(trigger); assert.equal(await detail.getAttribute('open'),null);
  }
  const detail=page.locator('article').filter({has:page.getByRole('heading',{name:'VIP 2',exact:true})}).locator('details');
  await press(detail.locator('summary')); await press(detail.getByRole('link',{name:'Continue to booking'}));
  await page.waitForURL('**/reserve?seat=VIP%202');
  assert.match(await page.locator('main').innerText(),/Selected: VIP 2/);assert.match(await page.locator('main').innerText(),/not available yet/i);
  await page.goto(`${base}/spaces`);
  const gallery=page.locator('details').filter({has:page.locator('img[alt="Couch seating photo 4"]')});
  await press(gallery.locator('summary'));assert.ok(await gallery.locator('div[aria-label$="enlarged photo"]').isVisible());
  assert.equal(await gallery.getByRole('link',{name:'Continue to booking'}).count(),0);await press(gallery.locator('summary'));
  const couch=page.locator('article').filter({has:page.getByRole('heading',{name:'Couch 2',exact:true})}).getByRole('link',{name:'Booking details'});await press(couch);await page.waitForURL('**/reserve?seat=Couch%202');
  assert.match(await page.locator('main').innerText(),/Selected: Couch 2/);
  console.log(`✓ ${name} (JavaScript ${javaScriptEnabled?'on':'off'}): all VIP photos open and close, seat handoff and gallery`);
 } finally {await context.close();await browser.close()}
}
