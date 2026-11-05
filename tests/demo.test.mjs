import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/index.mjs";
import { enableDemo } from "../scripts/enable-demo.mjs";

test("password-free demo keeps real role restrictions and persistent writes; normal CRM stays private", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bytmarket-demo-"));
  const dbPath = join(dir, "demo.sqlite");
  let app;
  t.after(async () => {
    if (app) await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  async function start(demoMode) {
    app = createApp({ dbPath, demoMode });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  }
  let base = await start(false),
    cookie = "",
    csrf = "";
  async function req(method, path, body, extra = {}) {
    const r = await fetch(base + "/api/v1" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": csrf,
        "Idempotency-Key": randomUUID(),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    const data = await r.json();
    if (data.csrf) csrf = data.csrf;
    return { status: r.status, data, headers: r.headers };
  }
  assert.equal((await req("GET", "/auth/me")).status, 401);
  assert.equal(
    (await req("POST", "/auth/demo", { role: "owner" })).status,
    404,
  );
  assert.equal(
    (
      await req("POST", "/auth/setup", {
        name: "Test owner",
        email: "owner@example.invalid",
        password: "test-demo-owner-pass",
      })
    ).status,
    200,
  );
  cookie = "";
  csrf = "";
  await app.close();
  app = null;
  assert.throws(() => createApp({ dbPath, demoMode: true }), /подготовленной/);
  enableDemo(dbPath);
  base = await start(true);
  assert.equal((await req("GET", "/auth/status")).data.demo, true);
  const owner = await req("GET", "/auth/me");
  assert.equal(owner.status, 200);
  assert.equal(owner.data.user.demo, true);
  assert.deepEqual(owner.data.user.roles, ["owner"]);
  assert.equal(
    (
      await req(
        "POST",
        "/auth/demo",
        { role: "courier" },
        { Origin: "https://evil.invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await req("POST", "/auth/demo", { role: "invented" })).status,
    400,
  );
  const meta = (await req("GET", "/meta")).data;
  assert.equal(
    (
      await req(
        "POST",
        "/tasks",
        { title: "Persisted demo task", entity_id: meta.entities[0].id },
        { "X-CSRF-Token": "" },
      )
    ).status,
    403,
  );
  const task = await req("POST", "/tasks", {
    title: "Persisted demo task",
    entity_id: meta.entities[0].id,
  });
  assert.equal(task.status, 200);
  const roles = (await req("GET", "/auth/demo-roles")).data;
  assert.equal(roles.length, 8);
  for (const role of roles) {
    const switched = await req("POST", "/auth/demo", { role });
    assert.equal(switched.status, 200);
    assert.deepEqual(switched.data.user.roles, [role]);
    assert.equal((await req("GET", "/auth/me")).data.user.roles[0], role);
  }
  assert.equal(
    (await req("GET", "/users")).status,
    403,
    "courier cannot access owner operations",
  );
  assert.equal((await req("GET", "/deliveries")).status, 200);
  await app.close();
  app = null;
  base = await start(true);
  await req("POST", "/auth/demo", { role: "owner" });
  assert.ok(
    (await req("GET", "/tasks?entity_id=" + meta.entities[0].id)).data.some(
      (x) => x.id === task.data.id,
    ),
  );
  assert.equal(
    (await req("PATCH", "/users/" + owner.data.user.id, { active: false }))
      .status,
    409,
  );
  await app.close();
  app = null;
  cookie = "";
  csrf = "";
  base = await start(false);
  assert.equal(
    (await req("GET", "/auth/me")).status,
    401,
    "marker alone must never enable public access",
  );
});

test("gzip preserves response content, honors disabled encoding and supports HEAD", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bytmarket-gzip-"));
  const body = "<html>" + "Тестовая CRM ".repeat(500) + "</html>";
  await writeFile(join(dir, "index.html"), body);
  const app = createApp({ dbPath: join(dir, "test.sqlite"), staticDir: dir });
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${app.server.address().port}/`;
  const compressed = await fetch(url, {
    headers: { "Accept-Encoding": "gzip" },
  });
  assert.equal(compressed.headers.get("content-encoding"), "gzip");
  assert.ok(
    Number(compressed.headers.get("content-length")) <
      Buffer.byteLength(body) / 2,
  );
  assert.equal(await compressed.text(), body);
  const plain = await fetch(url, {
    headers: { "Accept-Encoding": "gzip;q=0" },
  });
  assert.equal(plain.headers.get("content-encoding"), null);
  assert.equal(await plain.text(), body);
  const head = await fetch(url, {
    method: "HEAD",
    headers: { "Accept-Encoding": "gzip" },
  });
  assert.equal(
    head.headers.get("content-length"),
    compressed.headers.get("content-length"),
  );
  assert.equal(await head.text(), "");
});
