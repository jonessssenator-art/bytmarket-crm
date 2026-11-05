import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function createDb(path = "data/bytmarket.sqlite") {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,details TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS warehouses(id TEXT PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,roles TEXT NOT NULL,entity_ids TEXT NOT NULL,warehouse_ids TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'customer',phone TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',inn TEXT NOT NULL DEFAULT '',assigned_to TEXT REFERENCES users(id),credit_limit_cents INTEGER,term_days INTEGER,notes TEXT NOT NULL DEFAULT '',contacts TEXT NOT NULL DEFAULT '[]',addresses TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,sku TEXT NOT NULL UNIQUE,name TEXT NOT NULL,brand TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',barcode TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT 'шт.',pack_size INTEGER NOT NULL CHECK(pack_size>0),retail_cents INTEGER NOT NULL CHECK(retail_cents>=0),wholesale_cents INTEGER NOT NULL CHECK(wholesale_cents>=0),min_stock INTEGER NOT NULL DEFAULT 50 CHECK(min_stock>=0),active INTEGER NOT NULL DEFAULT 1,attributes TEXT NOT NULL DEFAULT '{}',expiry_required INTEGER NOT NULL DEFAULT 0,marked INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique ON products(barcode) WHERE barcode<>'';
CREATE TABLE IF NOT EXISTS inventory(entity_id TEXT NOT NULL REFERENCES entities(id),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),product_id TEXT NOT NULL REFERENCES products(id),on_hand INTEGER NOT NULL DEFAULT 0 CHECK(on_hand>=0),reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0),quarantine INTEGER NOT NULL DEFAULT 0 CHECK(quarantine>=0),cost_cents INTEGER,PRIMARY KEY(entity_id,warehouse_id,product_id),CHECK(reserved<=on_hand));
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,entity_id TEXT NOT NULL REFERENCES entities(id),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),client_id TEXT REFERENCES clients(id),channel TEXT NOT NULL,status TEXT NOT NULL,total_cents INTEGER NOT NULL,paid_cents INTEGER NOT NULL DEFAULT 0,refunded_cents INTEGER NOT NULL DEFAULT 0,returned_cents INTEGER NOT NULL DEFAULT 0,shipped_cents INTEGER NOT NULL DEFAULT 0,notes TEXT NOT NULL DEFAULT '',fulfillment TEXT NOT NULL,address TEXT NOT NULL DEFAULT '',due_date TEXT,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS order_lines(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),product_id TEXT NOT NULL REFERENCES products(id),name TEXT NOT NULL,sku TEXT NOT NULL,qty INTEGER NOT NULL CHECK(qty>0),unit_factor INTEGER NOT NULL CHECK(unit_factor>0),unit_price_cents INTEGER NOT NULL,line_total_cents INTEGER NOT NULL,shipped_qty INTEGER NOT NULL DEFAULT 0,returned_qty INTEGER NOT NULL DEFAULT 0,cost_cents INTEGER,CHECK(returned_qty<=shipped_qty),CHECK(shipped_qty<=qty));
CREATE TABLE IF NOT EXISTS stock_movements(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),product_id TEXT NOT NULL REFERENCES products(id),qty INTEGER NOT NULL,kind TEXT NOT NULL,reason TEXT NOT NULL,order_id TEXT REFERENCES orders(id),actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,cost_cents INTEGER);
CREATE TABLE IF NOT EXISTS stock_batches(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),product_id TEXT NOT NULL REFERENCES products(id),batch_number TEXT NOT NULL DEFAULT '',expires_at TEXT,supplier_id TEXT REFERENCES clients(id),qty INTEGER NOT NULL CHECK(qty>=0),reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=qty),quarantine INTEGER NOT NULL DEFAULT 0 CHECK(quarantine>=0),cost_cents INTEGER,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS order_batch_allocations(id TEXT PRIMARY KEY,line_id TEXT NOT NULL REFERENCES order_lines(id),batch_id TEXT NOT NULL REFERENCES stock_batches(id),qty INTEGER NOT NULL,shipped_qty INTEGER NOT NULL DEFAULT 0,returned_qty INTEGER NOT NULL DEFAULT 0,cost_cents INTEGER);
CREATE TABLE IF NOT EXISTS line_quotes(line_id TEXT PRIMARY KEY REFERENCES order_lines(id) ON DELETE CASCADE,quantity INTEGER NOT NULL,unit TEXT NOT NULL,discount_percent INTEGER NOT NULL DEFAULT 0,promotion_id TEXT,base_price_cents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL REFERENCES entities(id),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),product_id TEXT NOT NULL REFERENCES products(id),available INTEGER NOT NULL,threshold INTEGER NOT NULL,status TEXT NOT NULL,read_at TEXT,created_at TEXT NOT NULL,resolved_at TEXT,assigned_to TEXT REFERENCES users(id));
CREATE UNIQUE INDEX IF NOT EXISTS alerts_open_unique ON alerts(entity_id,warehouse_id,product_id) WHERE status='open';
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,object_type TEXT NOT NULL,object_id TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency(user_id TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,key));
CREATE INDEX IF NOT EXISTS orders_client_idx ON orders(client_id);
CREATE INDEX IF NOT EXISTS orders_scope_idx ON orders(entity_id,warehouse_id,created_by);
CREATE INDEX IF NOT EXISTS stock_batch_scope_idx ON stock_batches(entity_id,warehouse_id,product_id);
`);
  const cols = db
    .prepare("PRAGMA table_info(stock_movements)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("revenue_cents"))
    db.exec("ALTER TABLE stock_movements ADD COLUMN revenue_cents INTEGER");
  if (!cols.includes("order_line_id"))
    db.exec(
      "ALTER TABLE stock_movements ADD COLUMN order_line_id TEXT REFERENCES order_lines(id)",
    );
  return db;
}
