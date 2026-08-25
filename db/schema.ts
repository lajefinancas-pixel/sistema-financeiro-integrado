import { boolean, index, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const supplierPaymentMethods = pgTable("supplier_payment_methods", {
  id: uuid().defaultRandom().primaryKey(),
  supplierId: text("supplier_id").notNull(),
  kind: text().notNull(),
  label: text(),
  pixKeyType: text("pix_key_type"),
  pixKey: text("pix_key"),
  bankName: text("bank_name"),
  bankCode: text("bank_code"),
  agency: text(),
  account: text(),
  accountDigit: text("account_digit"),
  accountType: text("account_type"),
  holderName: text("holder_name").notNull(),
  holderDocument: text("holder_document"),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("supplier_payment_methods_supplier_idx").on(table.supplierId)]);

export const supplierPaymentMethodEvents = pgTable("supplier_payment_method_events", {
  id: uuid().defaultRandom().primaryKey(),
  supplierId: text("supplier_id").notNull(),
  paymentMethodId: uuid("payment_method_id"),
  action: text().notNull(),
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const transferOperationMirrors = pgTable("transfer_operation_mirrors", {
  id: uuid().defaultRandom().primaryKey(),
  externalTransferId: text("external_transfer_id").notNull().unique(),
  idempotencyKey: text("idempotency_key").notNull(),
  programId: text("program_id").notNull(),
  sourceAccountId: text("source_account_id").notNull(),
  destinationAccountId: text("destination_account_id").notNull(),
  amount: numeric({ precision: 14, scale: 2 }).notNull(),
  userId: text("user_id").notNull(),
  note: text(),
  status: text().notNull().default("confirmed"),
  payload: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
