// Unit table for the Vietnamese event-date parser (phase-01 / 9A). Fixed `now` for
// determinism: 2026-06-30 is a TUESDAY (JS getDay()=2).
import { test, expect } from "bun:test";
import { inferEventDate } from "../../src/lib/vietnamese-date-parser.ts";

const NOW = new Date(2026, 5, 30); // 2026-06-30, local, Tuesday

function d(text: string) {
  return inferEventDate(text, NOW);
}

test("absolute date with year: d/m/yyyy and d-m-yyyy", () => {
  expect(d("Họp ngày 12/04/2026 với sếp")?.date).toBe("2026-04-12");
  expect(d("sự kiện 3-2-2025 quan trọng")?.date).toBe("2025-02-03");
});

test("worded: ngày 12 tháng 4 [năm]", () => {
  expect(d("Đi chơi ngày 12 tháng 4")?.date).toBe("2026-04-12"); // year-less → this year (past)
  expect(d("cưới ngày 1 tháng 12 năm 2024")?.date).toBe("2024-12-01");
});

test("bare d/m needs date-y context (hôm/ngày)", () => {
  expect(d("hôm 12/4 Vy sốt")?.date).toBe("2026-04-12");
  expect(d("hôm 12/4 Vy sốt")?.yearGuessed).toBe(true);
  // year-less d/m in the FUTURE this year → roll back a year
  expect(d("hôm 12/12 đi Đà Lạt")?.date).toBe("2025-12-12");
});

test("SAFETY: a bare d/m WITHOUT date context is NOT a date", () => {
  expect(d("pha 3/4 cốc cà phê")).toBeNull();
  expect(d("tỉ số 2/1 nghẹt thở")).toBeNull();
  expect(d("dùng bản v1/2 beta")).toBeNull();
  expect(d("còn 1/2 ổ bánh mì")).toBeNull();
});

test("SAFETY: vague phrases keep today (return null)", () => {
  expect(d("dạo này hay lo")).toBeNull();
  expect(d("gần đây ngủ kém")).toBeNull();
  expect(d("mấy hôm nay mệt")).toBeNull();
  expect(d("hôm nay đi làm")).toBeNull(); // "hôm nay" = today, not a past marker
});

test("relative day words", () => {
  expect(d("hôm qua ăn phở")?.date).toBe("2026-06-29");
  expect(d("hôm kia gặp bạn")?.date).toBe("2026-06-28");
});

test("relative week / month", () => {
  expect(d("tuần trước đi bơi")?.date).toBe("2026-06-23"); // -7d
  expect(d("tháng trước nghỉ phép")?.date).toBe("2026-05-30"); // -1 month
});

test("cuối tuần (trước) → Saturday of last week", () => {
  // NOW=Tue 2026-06-30. Last Saturday = 2026-06-27 (delta from Tue(2) to Sat(6) past).
  expect(d("cuối tuần dẫn con đi bơi")?.date).toBe("2026-06-27");
  expect(d("cuối tuần trước về quê")?.date).toBe("2026-06-27");
});

test("thứ N vừa rồi → most recent past weekday", () => {
  // NOW=Tue(2). thứ 7 = Sat(6) → last Sat = 2026-06-27. thứ 2 = Mon(1) → last Mon = 2026-06-29.
  expect(d("thứ 7 vừa rồi đi cà phê")?.date).toBe("2026-06-27");
  expect(d("thứ 2 tuần trước họp")?.date).toBe("2026-06-29");
  expect(d("chủ nhật vừa rồi ngủ nướng")?.date).toBe("2026-06-28"); // Sun → 06-28
});

test("SAFETY: a bare weekday WITHOUT vừa rồi/tuần trước is ambiguous → null", () => {
  expect(d("thứ 7 này đi chơi")).toBeNull(); // future/this — don't guess
  expect(d("thứ 7 đi chơi")).toBeNull();
});

test("invalid calendar dates rejected (no crash)", () => {
  expect(d("hôm 31/2 chuyện lạ")).toBeNull(); // Feb 31 invalid
  expect(d("ngày 32/1/2026")).toBeNull();
});

test("phrase field carries the matched source text", () => {
  expect(d("hôm 12/4 Vy sốt")?.phrase).toContain("12/4");
  expect(d("hôm qua ăn phở")?.phrase).toBe("hôm qua");
});

test("no date expression → null (keep today)", () => {
  expect(d("Ăn phở với bạn, vui")).toBeNull();
  expect(d("")).toBeNull();
});
