import assert from "node:assert/strict";
import { formatClubTime12h } from "../src/lib/utils/datetime";
const normal=(s:string)=>s.replace(/\s+/g," ").trim();
for(const [value,label] of [["00:00","12:00 AM"],["00:30","12:30 AM"],["04:00","4:00 AM"],["12:00","12:00 PM"],["12:15","12:15 PM"],["21:00","9:00 PM"],["23:30","11:30 PM"]] as const) assert.equal(normal(formatClubTime12h(value)),label);
console.log("12-hour display: midnight, noon and overnight boundaries passed");
