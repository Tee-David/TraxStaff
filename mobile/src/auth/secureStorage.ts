import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Key/value storage for credentials.
 *
 * expo-secure-store ships no web implementation — every call throws
 * "ExpoSecureStore.default.setValueWithKeyAsync is not a function", which took
 * out sign-in entirely under `expo start --web`.
 *
 * The web target exists ONLY so the layout can be reviewed in a desktop browser.
 * localStorage is plain text and readable by any script on the origin; it is not
 * equivalent to the Android Keystore and web must never be treated as a
 * supported client for real credentials. On device this is unchanged.
 */
const isWeb = Platform.OS === "web";

function webStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Access itself throws when cookies/storage are blocked.
    return null;
  }
}

export async function getSecret(key: string): Promise<string | null> {
  if (isWeb) return webStore()?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (isWeb) {
    webStore()?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  if (isWeb) {
    webStore()?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
