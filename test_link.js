require("dotenv").config({ path: "./.env" });
const db = require("./db");
async function testLink() {
  try {
    const code = "775549";
    const [rows] = await db.query("SELECT * FROM linking_codes WHERE code = ? AND is_used = 0", [code]);
    if (rows.length === 0) {
      console.log("NOT FOUND");
      return;
    }
    const link = rows[0];
    console.log("Link code found:", link);
    if (new Date() > new Date(link.expires_at)) {
      console.log("EXPIRED");
      return;
    }
    const device_id = null;
    const [updateResult] = await db.query(
      "UPDATE children SET device_id = ?, parent_id = ? WHERE id = ?",
      [device_id || null, link.parent_id, link.child_id]
    );
    console.log("Update result:", updateResult);
  } catch(e) {
    console.error("ERROR:", e);
  } finally {
    process.exit();
  }
}
testLink();
