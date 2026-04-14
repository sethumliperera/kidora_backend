const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// 🔥 Schema (since you don't have models folder)
const restrictionSchema = new mongoose.Schema({
  parentId: String,
  childId: String,
  type: String,
  startTime: String,
  endTime: String,
  days: [String],
  blockedApps: [String],
  enabled: Boolean,
});

const Restriction = mongoose.model("Restriction", restrictionSchema);

// CREATE
router.post("/", async (req, res) => {
  try {
    const newRestriction = new Restriction(req.body);
    const saved = await newRestriction.save();
    res.json(saved);
  } catch (err) {
    res.status(500).json(err);
  }
});

// GET (by childId)
router.get("/:childId", async (req, res) => {
  try {
    const data = await Restriction.find({
      childId: req.params.childId,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json(err);
  }
});

// UPDATE
router.put("/:id", async (req, res) => {
  try {
    const updated = await Restriction.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json(err);
  }
});

//  DELETE
router.delete("/:id", async (req, res) => {
  try {
    await Restriction.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json(err);
  }
});

module.exports = router;
