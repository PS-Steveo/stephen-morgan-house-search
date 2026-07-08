import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from "amazon-cognito-identity-js";
import { config } from "./config";

export type Role = "owner" | "viewer";

export interface Session {
  idToken: string;
  role: Role;
  email: string;
}

let pool: CognitoUserPool | null = null;
function getPool(): CognitoUserPool {
  if (!pool) {
    pool = new CognitoUserPool({
      UserPoolId: config.userPoolId,
      ClientId: config.userPoolClientId,
    });
  }
  return pool;
}

function toSession(session: CognitoUserSession): Session {
  const idToken = session.getIdToken();
  const payload = idToken.decodePayload() as Record<string, unknown>;
  const role = payload["custom:role"];
  return {
    idToken: idToken.getJwtToken(),
    role: role === "owner" ? "owner" : "viewer", // fail closed, mirrors the API's default
    email: (payload["email"] as string) ?? "",
  };
}

export type SignInResult =
  | { status: "success"; session: Session }
  | { status: "newPasswordRequired"; cognitoUser: CognitoUser };

export function signIn(username: string, password: string): Promise<SignInResult> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: username, Pool: getPool() });
    const authDetails = new AuthenticationDetails({ Username: username, Password: password });
    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve({ status: "success", session: toSession(session) }),
      onFailure: (err) => reject(err),
      newPasswordRequired: () => resolve({ status: "newPasswordRequired", cognitoUser: user }),
    });
  });
}

export function completeNewPassword(cognitoUser: CognitoUser, newPassword: string): Promise<Session> {
  return new Promise((resolve, reject) => {
    cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
      onSuccess: (session) => resolve(toSession(session)),
      onFailure: (err) => reject(err),
    });
  });
}

export function getCurrentSession(): Promise<Session | null> {
  return new Promise((resolve) => {
    const user = getPool().getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      resolve(toSession(session));
    });
  });
}

export function signOut() {
  getPool().getCurrentUser()?.signOut();
}
