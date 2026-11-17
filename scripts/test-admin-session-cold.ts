/** Disposable-only cold-start regression: validates sessions with no pre-existing Mongoose connection. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import mongoose from "mongoose";
import { hashSessionToken, validateSession } from "../src/lib/auth/session";
import { disconnectFromDatabase } from "../src/lib/db/mongoose";

async function main() {
  const dbName = process.env.MONGODB_DB_NAME ?? "";
  if (!/^publiq_booking_test_[a-f0-9]{12}$/.test(dbName)) throw new Error("Refusing to test outside disposable DB");
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(dbName), id = new ObjectId(), token = randomBytes(32).toString("base64url");
  try {
    await db.collection("admin_users").insertOne({_id:id,name:"Test Admin",email:"test-admin@example.test",role:"SUPER_ADMIN",isActive:true});
    await db.collection("admin_sessions").insertOne({user:id,tokenHash:hashSessionToken(token),expiresAt:new Date(Date.now()+3600000),revokedAt:null});
    assert.notEqual(mongoose.connection.readyState, 1, "test must start without a mongoose connection");
    const valid = await validateSession(token);
    assert.equal(valid?.user.id, String(id));
    assert.equal(valid?.user.role, "SUPER_ADMIN");
    await db.collection("admin_users").updateOne({_id:id},{$set:{isActive:false}});
    assert.equal(await validateSession(token), null);
    console.log("✓ Cold-start admin session connects before querying; inactive account denied");
  } finally { await db.dropDatabase(); await client.close(); await disconnectFromDatabase(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
