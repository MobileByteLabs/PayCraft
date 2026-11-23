// badProductId: every /v1/products/{id}/* route checks the id before it reaches Postgres.
// Before, a sku or a missing id ("undefined") hit the uuid column and returned a generic 500.
import { badProductId } from "@/lib/api-v1-helpers"

test("accepts a UUID", () => {
  expect(badProductId("dc19b760-8c03-487a-a0a4-561c3987d4d5")).toBeNull()
})

test.each(["pro-lifetime", "undefined", "", undefined, "dc19b760-8c03-487a-a0a4"])("400s %p", async (id) => {
  const res = badProductId(id as string | undefined)!
  expect(res.status).toBe(400)
  expect((await res.json()).error).toBe("invalid_product_id")
})
