import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Google Drive module against a faked Google. Nothing here touches the network
 * or a database: `fetch` is stubbed and `prisma.setting` is a Map, so what is
 * under test is the module's own behaviour — the requests it makes, what it
 * stores, and what it does when Google says no.
 */

const store = new Map<string, string>();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        store.has(where.key) ? { key: where.key, value: store.get(where.key)! } : null,
      upsert: async ({ where, create, update }: { where: { key: string }; create: { value: string }; update: { value: string } }) => {
        store.set(where.key, store.has(where.key) ? update.value : create.value);
      },
    },
  },
}));

import * as drive from "@/lib/google-drive";

type Call = { url: string; method: string; body?: unknown };
let calls: Call[] = [];
let responder: (url: string, init: RequestInit) => Response | Promise<Response>;

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

beforeEach(() => {
  store.clear();
  calls = [];
  drive.resetTokenCache();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body });
    return responder(String(url), init);
  });
});

async function connected() {
  store.set(
    "backup_google",
    JSON.stringify({ clientId: "cid", clientSecret: "sec", refreshToken: "rt", email: "owner@example.com" })
  );
}

describe("client credentials", () => {
  it("never reports the secret or the token", async () => {
    await connected();
    const status = await drive.getStatus();
    expect(status).toEqual({ hasClient: true, clientId: "cid", hasSecret: true, connected: true, email: "owner@example.com" });
    expect(JSON.stringify(status)).not.toContain("sec\"");
    expect(JSON.stringify(status)).not.toContain("rt");
  });

  it("keeps the stored secret when only the id is re-saved", async () => {
    await connected();
    await drive.saveClient("cid", undefined);
    const s = await drive.loadSecrets();
    expect(s.clientSecret).toBe("sec");
    expect(s.refreshToken).toBe("rt");
  });

  it("drops the connection when the client changes — the token belongs to the old one", async () => {
    await connected();
    await drive.saveClient("other-client", "new-secret");
    const s = await drive.loadSecrets();
    expect(s.refreshToken).toBeUndefined();
    expect(s.clientId).toBe("other-client");
  });
});

describe("buildAuthUrl", () => {
  it("asks for offline, file-scoped access and carries the state", () => {
    const url = new URL(drive.buildAuthUrl("cid", "http://localhost:3000/cb", "abc"));
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/cb");
  });
});

describe("completeConnection", () => {
  it("stores the refresh token and the account email", async () => {
    store.set("backup_google", JSON.stringify({ clientId: "cid", clientSecret: "sec" }));
    responder = (url) =>
      url.includes("/token")
        ? json({ access_token: "at", refresh_token: "rt1", expires_in: 3600 })
        : json({ user: { emailAddress: "me@example.com" } });
    expect(await drive.completeConnection("code", "http://x/cb")).toBe("me@example.com");
    expect(await drive.getStatus()).toMatchObject({ connected: true, email: "me@example.com" });
  });

  it("explains a missing refresh token instead of storing nothing quietly", async () => {
    store.set("backup_google", JSON.stringify({ clientId: "cid", clientSecret: "sec" }));
    responder = () => json({ access_token: "at", expires_in: 3600 });
    await expect(drive.completeConnection("code", "http://x/cb")).rejects.toThrow(/refresh token/i);
  });
});

describe("access token", () => {
  it("reuses a token until it is about to expire", async () => {
    await connected();
    responder = (url) => (url.includes("/token") ? json({ access_token: "at", expires_in: 3600 }) : json({ files: [] }));
    await drive.listFiles("folder");
    await drive.listFiles("folder");
    expect(calls.filter((c) => c.url.includes("/token"))).toHaveLength(1);
  });

  it("turns invalid_grant into an instruction to reconnect", async () => {
    await connected();
    responder = () => json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 });
    await expect(drive.listFiles("folder")).rejects.toThrow(/reconnect/i);
  });

  it("refuses to run when nothing is connected", async () => {
    store.set("backup_google", JSON.stringify({ clientId: "cid", clientSecret: "sec" }));
    await expect(drive.listFiles("folder")).rejects.toThrow(/not connected/i);
  });
});

describe("ensureFolder", () => {
  const withToken = (rest: (url: string, init: RequestInit) => Response) => {
    responder = (url, init) => (url.includes("/token") ? json({ access_token: "at", expires_in: 3600 }) : rest(url, init));
  };

  it("creates the folder when none exists, then remembers it", async () => {
    await connected();
    withToken((url, init) => {
      if (init.method === "POST") return json({ id: "new-folder" });
      return json({ files: [] });
    });
    expect(await drive.ensureFolder("POS_Backups")).toBe("new-folder");
    expect((await drive.loadSecrets()).folderId).toBe("new-folder");
  });

  it("reuses an existing folder of that name", async () => {
    await connected();
    withToken(() => json({ files: [{ id: "existing" }] }));
    expect(await drive.ensureFolder("POS_Backups")).toBe("existing");
    expect(calls.some((c) => c.method === "POST" && !c.url.includes("/token"))).toBe(false);
  });

  it("makes a new folder when the remembered one was trashed", async () => {
    store.set("backup_google", JSON.stringify({ clientId: "cid", clientSecret: "sec", refreshToken: "rt", folderId: "old", folderName: "POS_Backups" }));
    withToken((url, init) => {
      if (url.includes("/files/old")) return json({ id: "old", trashed: true });
      if (init.method === "POST") return json({ id: "fresh" });
      return json({ files: [] });
    });
    expect(await drive.ensureFolder("POS_Backups")).toBe("fresh");
  });
});

describe("uploadFile", () => {
  it("opens a resumable session inside the folder, then sends the bytes", async () => {
    await connected();
    responder = (url, init) => {
      if (url.includes("/token")) return json({ access_token: "at", expires_in: 3600 });
      if (url.includes("uploadType=resumable")) {
        return new Response("{}", { status: 200, headers: { Location: "https://upload.example/session-1" } });
      }
      if (url === "https://upload.example/session-1" && init.method === "PUT") return json({ id: "file-1" });
      return new Response("unexpected", { status: 500 });
    };
    const id = await drive.uploadFile("pos-backup-2026-10-09_2330.json.gz", new Uint8Array([1, 2, 3]), "folder-1");
    expect(id).toBe("file-1");
    const start = calls.find((c) => c.url.includes("uploadType=resumable"))!;
    expect(JSON.parse(String(start.body))).toEqual({ name: "pos-backup-2026-10-09_2330.json.gz", parents: ["folder-1"] });
  });

  it("reports a failed upload instead of pretending it worked", async () => {
    await connected();
    responder = (url) => {
      if (url.includes("/token")) return json({ access_token: "at", expires_in: 3600 });
      if (url.includes("uploadType=resumable")) return new Response("{}", { headers: { Location: "https://upload.example/s" } });
      return json({ error: { message: "The user's Drive storage quota has been exceeded." } }, { status: 403 });
    };
    await expect(drive.uploadFile("f", new Uint8Array([1]), "folder")).rejects.toThrow(/quota/i);
  });
});

describe("listFiles", () => {
  it("follows pagination and parses sizes and times", async () => {
    await connected();
    let page = 0;
    responder = (url) => {
      if (url.includes("/token")) return json({ access_token: "at", expires_in: 3600 });
      page += 1;
      return page === 1
        ? json({ files: [{ id: "a", name: "A", size: "10", modifiedTime: "2026-10-01T00:00:00Z" }], nextPageToken: "p2" })
        : json({ files: [{ id: "b", name: "B", size: "20", modifiedTime: "2026-10-02T00:00:00Z" }] });
    };
    const files = await drive.listFiles("folder");
    expect(files.map((f) => f.id)).toEqual(["a", "b"]);
    expect(files[1]).toMatchObject({ bytes: 20, mtimeMs: Date.parse("2026-10-02T00:00:00Z") });
  });
});
