import { cookies } from "next/headers";
import { customerGoogleConfig } from "./config";
import { unseal } from "./crypto";
export const CUSTOMER_COOKIE = "publiq_customer_session";
export const GOOGLE_FLOW_COOKIE = "publiq_google_flow";
export type CustomerSession = { sub: string; email: string; name: string; exp: number };
export async function getCustomerSession(): Promise<CustomerSession | null> {
  const config = customerGoogleConfig(); if (!config) return null;
  const value = (await cookies()).get(CUSTOMER_COOKIE)?.value; if (!value) return null;
  const data = unseal<CustomerSession>(value, config.sessionSecret);
  if (!data || typeof data.sub !== "string" || !data.sub || typeof data.email !== "string" || typeof data.name !== "string" || !Number.isSafeInteger(data.exp) || data.exp <= Date.now()) return null;
  return data;
}
