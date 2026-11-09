import assert from "node:assert/strict";
import test from "node:test";
import { createInterpretationRequestGuard } from "../lib/interpretation-request.ts";

test("a late interpretation cannot be reviewed or applied after the original text changes", () => {
  const guard = createInterpretationRequestGuard();
  const oldRequest = guard.begin("Exactly 40 boxes, budget $80.");
  guard.invalidate();
  assert.equal(guard.isCurrent(oldRequest, "Exactly 50 boxes, budget $100."), false);
  // Returning to the same words does not revive a response from an earlier edit.
  assert.equal(guard.isCurrent(oldRequest, "Exactly 40 boxes, budget $80."), false);
});

test("overlapping responses can only finish the latest request", () => {
  const guard = createInterpretationRequestGuard();
  const first = guard.begin("40 boxes");
  const second = guard.begin("50 boxes");
  assert.equal(guard.isCurrent(first, "50 boxes"), false);
  assert.equal(guard.isCurrent(second, "50 boxes"), true);
  assert.equal(guard.isCurrent(second, "40 boxes"), false);
});

test("manual field edits or closing the editor invalidate a previously valid interpretation", () => {
  const guard = createInterpretationRequestGuard();
  const request = guard.begin("40 boxes, budget $80");
  assert.equal(guard.isCurrent(request, "40 boxes, budget $80"), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(request, "40 boxes, budget $80"), false);
  assert.equal(guard.isCurrent(null, "40 boxes, budget $80"), false);
});
