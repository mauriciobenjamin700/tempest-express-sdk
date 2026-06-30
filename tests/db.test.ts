import { BaseModel, column, columnsOf, tableNameFor } from "@/index";
import { describe, expect, it } from "vitest";

class UserModel extends BaseModel {
  static override tablename = tableNameFor("UserModel");
  email = column.varchar(320).notNull();
  name = column.text().notNull();
}

describe("BaseModel", () => {
  it("derives a snake_case table name without the Model suffix", () => {
    expect(tableNameFor("UserModel")).toBe("user");
    expect(tableNameFor("OrderItemModel")).toBe("order_item");
    expect(UserModel.tablename).toBe("user");
  });

  it("contributes the four canonical columns to subclasses", () => {
    const columns = columnsOf(UserModel);
    expect(Object.keys(columns).sort()).toEqual(
      ["createdAt", "email", "id", "isActive", "name", "updatedAt"].sort(),
    );
    expect(columns.id?.flags.primaryKey).toBe(true);
    expect(columns.isActive?.flags.notNull).toBe(true);
  });
});
