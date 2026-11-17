import assert from "node:assert/strict";
import { vipConsumableMinimum as minimum } from "../src/lib/utils/publiq-vip-policy";
for (const n of [1, 2, 3, 4, 5]) assert.equal(minimum(n), 0);
for (const n of [6, 7, 8]) assert.equal(minimum(n), 700_000);
assert.equal(minimum(9), 850_000);
for (const n of [10, 11, 12]) assert.equal(minimum(n), 1_000_000);
for (const n of [0, 13, 1.5, NaN, Infinity]) assert.throws(() => minimum(n), RangeError);
console.log("VIP consumable policy: all 12 valid guest counts and invalid inputs passed");
