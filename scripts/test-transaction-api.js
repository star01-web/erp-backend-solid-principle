require("dotenv").config();
const db = require("../src/common/index.db");
const invCtrl = require("../src/modules/inventory/inventory_controller/inventory.controller");
const { dispatchController } = require("../src/modules/inventory/inventory.module");

// Helper mock Express req & res
function createMockReqRes(query = {}) {
  const req = { query };
  let statusCode = 200;
  let jsonResponse = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
  };

  return { req, res, getResult: () => ({ statusCode, jsonResponse }) };
}

async function runTests() {
  console.log("==================================================");
  console.log("🚀 STARTING TRANSACTION GET API VERIFICATION TESTS");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, extraInfo = "") {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} ${extraInfo}`);
      failed++;
    }
  }

  try {
    await db.sequelize.authenticate();
    console.log("📦 Database connected successfully.\n");

    // -------------------------------------------------------------
    // TEST 1: Default Pagination Contract
    // -------------------------------------------------------------
    {
      const { req, res, getResult } = createMockReqRes({});
      await invCtrl.getTransactionHistory(req, res);
      const { statusCode, jsonResponse } = getResult();

      assert(statusCode === 200, "Test 1: Status is 200");
      assert(jsonResponse.success === true, "Test 1: success is true");
      assert(typeof jsonResponse.totalItems === "number", "Test 1: totalItems is number");
      assert(typeof jsonResponse.totalPages === "number", "Test 1: totalPages is number");
      assert(jsonResponse.currentPage === 1, "Test 1: currentPage is 1");
      assert(jsonResponse.limit === 20, "Test 1: default limit is 20");
      assert(Array.isArray(jsonResponse.data), "Test 1: data is array");
      assert(typeof jsonResponse.hasNextPage === "boolean", "Test 1: hasNextPage is boolean");
      assert(typeof jsonResponse.hasPrevPage === "boolean", "Test 1: hasPrevPage is boolean");
    }

    // -------------------------------------------------------------
    // TEST 2: Custom Limit & Pagination
    // -------------------------------------------------------------
    {
      const { req, res, getResult } = createMockReqRes({ page: 1, limit: 5 });
      await invCtrl.getTransactionHistory(req, res);
      const { jsonResponse } = getResult();

      assert(jsonResponse.limit === 5, "Test 2: limit is 5");
      assert(jsonResponse.data.length <= 5, "Test 2: data length <= 5");
      if (jsonResponse.totalItems > 5) {
        assert(jsonResponse.totalPages === Math.ceil(jsonResponse.totalItems / 5), "Test 2: totalPages calculated correctly");
        assert(jsonResponse.hasNextPage === true, "Test 2: hasNextPage is true when items > 5");
      }
    }

    // -------------------------------------------------------------
    // TEST 3: Memory Safety Cap (limit=all & limit=50000)
    // -------------------------------------------------------------
    {
      const { req, res, getResult } = createMockReqRes({ limit: "all" });
      await invCtrl.getTransactionHistory(req, res);
      const { jsonResponse } = getResult();

      assert(jsonResponse.limit === 2000, "Test 3a: limit=all capped to MAX_PAGE_LIMIT (2000)");
      assert(jsonResponse.currentPage === 1, "Test 3a: currentPage is 1 on limit=all");
      assert(jsonResponse.totalPages === 1, "Test 3a: totalPages is 1 on limit=all");
    }
    {
      const { req, res, getResult } = createMockReqRes({ limit: 50000 });
      await invCtrl.getTransactionHistory(req, res);
      const { jsonResponse } = getResult();

      assert(jsonResponse.limit === 2000, "Test 3b: limit=50000 capped to 2000");
    }

    // -------------------------------------------------------------
    // TEST 4: Malformed Page & Limit Handling
    // -------------------------------------------------------------
    {
      const { req, res, getResult } = createMockReqRes({ page: "invalid", limit: -10 });
      await invCtrl.getTransactionHistory(req, res);
      const { jsonResponse } = getResult();

      assert(jsonResponse.currentPage === 1, "Test 4: invalid page gracefully defaults to 1");
      assert(jsonResponse.limit === 20, "Test 4: negative limit gracefully defaults to 20");
    }

    // -------------------------------------------------------------
    // TEST 5: Type Normalization & Aliases (OUT, OUTWARD, outward, ALL_OUTWARD)
    // -------------------------------------------------------------
    {
      // 5a. type=outward (lowercase)
      const { req, res, getResult } = createMockReqRes({ type: "outward" });
      await invCtrl.getTransactionHistory(req, res);
      const { jsonResponse } = getResult();
      assert(jsonResponse.success === true, "Test 5a: type=outward lowercase query executes successfully");
      const allOutward = jsonResponse.data.every((r) => r.type === "OUTWARD");
      assert(allOutward, "Test 5a: all records returned have type OUTWARD");
    }
    {
      // 5b. type=OUT (alias)
      const { req, res, getResult } = createMockReqRes({ type: "OUT" });
      await invCtrl.getTransactionHistory(req, res);
      const { jsonResponse } = getResult();
      assert(jsonResponse.success === true, "Test 5b: type=OUT alias query executes successfully");
      const allOutward = jsonResponse.data.every((r) => r.type === "OUTWARD");
      assert(allOutward, "Test 5b: type=OUT correctly maps to OUTWARD");
    }
    {
      // 5c. type=IN (alias)
      const { req, res, getResult } = createMockReqRes({ type: "IN" });
      await invCtrl.getTransactionHistory(req, res);
      const { jsonResponse } = getResult();
      assert(jsonResponse.success === true, "Test 5c: type=IN alias query executes successfully");
      const allInward = jsonResponse.data.every((r) => r.type === "INWARD");
      assert(allInward, "Test 5c: type=IN correctly maps to INWARD");
    }
    {
      // 5d. Multi-type: type=OUTWARD,INWARD
      const { req, res, getResult } = createMockReqRes({ type: "OUTWARD,INWARD" });
      await invCtrl.getTransactionHistory(req, res);
      const { jsonResponse } = getResult();
      assert(jsonResponse.success === true, "Test 5d: multi-type OUTWARD,INWARD executes successfully");
      const validTypes = jsonResponse.data.every((r) => r.type === "OUTWARD" || r.type === "INWARD");
      assert(validTypes, "Test 5d: all returned records match OUTWARD or INWARD");
    }
    {
      // 5e. Group alias: type=ALL_OUTWARD
      const { req, res, getResult } = createMockReqRes({ type: "ALL_OUTWARD" });
      await invCtrl.getTransactionHistory(req, res);
      const { jsonResponse } = getResult();
      assert(jsonResponse.success === true, "Test 5e: group alias ALL_OUTWARD executes successfully");
      const validOutwardGroup = jsonResponse.data.every((r) =>
        ["OUTWARD", "DISPATCH", "SCRAP", "DAMAGE"].includes(r.type)
      );
      assert(validOutwardGroup, "Test 5e: records match outward group types");
    }

    // -------------------------------------------------------------
    // TEST 6: Date Range Filtering (End of day boundary)
    // -------------------------------------------------------------
    {
      const { req, res, getResult } = createMockReqRes({
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      });
      await invCtrl.getTransactionHistory(req, res);
      const { jsonResponse } = getResult();
      assert(jsonResponse.success === true, "Test 6: Date range query executes successfully");
    }

    // -------------------------------------------------------------
    // TEST 7: Dispatch Ledger History Pagination & Type Filtering
    // -------------------------------------------------------------
    {
      const { req, res, getResult } = createMockReqRes({
        page: 1,
        limit: 5,
        transaction_type: "DISPATCH",
      });
      await dispatchController.getDispatchLogs(req, res, (err) => console.error(err));
      const { statusCode, jsonResponse } = getResult();

      assert(statusCode === 200, "Test 7: Dispatch ledger status 200");
      assert(jsonResponse.success === true, "Test 7: Dispatch ledger success true");
      assert(typeof jsonResponse.count === "number", "Test 7: Dispatch ledger count is number");
      assert(typeof jsonResponse.totalItems === "number", "Test 7: Dispatch ledger totalItems is number");
      assert(typeof jsonResponse.totalPages === "number", "Test 7: Dispatch ledger totalPages is number");
      assert(jsonResponse.limit === 5, "Test 7: Dispatch ledger limit is 5");
      assert(Array.isArray(jsonResponse.data), "Test 7: Dispatch ledger data is array");
    }

  } catch (error) {
    console.error("❌ Unexpected Error during tests:", error);
    failed++;
  } finally {
    console.log("\n==================================================");
    console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================");
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
