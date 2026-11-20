import { describe, expect, it } from "vitest";
import { collectPlacesFromRows } from "./places";

const at = (day: number) => new Date(Date.UTC(2022, 2, day, 12, 0, 0));
const record = (id: number, name: string, lat: number, lng: number, day: number) => ({
  id,
  kind: "location",
  timestamp: at(day),
  createdAt: at(day),
  meta: { name, lat, lng },
});

describe("the places in the record", () => {
  it("merges the same name, and merges unnamed points by their coordinates", () => {
    const records = [
      record(1, "拾光咖啡", 31.2304, 121.4737, 1),
      record(2, "拾光咖啡", 31.2304, 121.4737, 2),
      record(3, "拾光咖啡", 31.2304, 121.4737, 3),
      record(4, "拾光咖啡", 31.2304, 121.4737, 4),
      { ...record(5, "", 31.24001, 121.48001, 5) },
      { ...record(6, "", 31.24002, 121.48002, 6) },
      { ...record(7, "", 31.24003, 121.48003, 7) },
      { ...record(8, "", 31.2501, 121.4901, 8) },
      record(9, "外滩", 31.24, 121.49, 9),
      record(10, "外滩", 31.24, 121.49, 10),
    ];
    const places = collectPlacesFromRows(records, []);
    expect(places).toHaveLength(4);
    const coffee = places.find((place) => place.name === "拾光咖啡")!;
    expect(coffee.count).toBe(4);
    expect(coffee.first).toBe(at(1).toISOString());
    expect(coffee.last).toBe(at(4).toISOString());
    const unnamed = places.filter((place) => !place.name.includes("拾光") && !place.name.includes("外滩"));
    expect(unnamed).toHaveLength(2);
    expect(unnamed.map((place) => place.count).sort()).toEqual([1, 3]);
    const bund = places.find((place) => place.name === "外滩")!;
    expect(bund.count).toBe(2);
  });

  it("reads a photo's coordinates from its EXIF and adds it to the same unnamed place", () => {
    const places = collectPlacesFromRows(
      [record(1, "", 31.24001, 121.48001, 1)],
      [{ id: 9, at: at(2), exif: { latitude: 31.24002, longitude: 121.48002 } }],
    );
    expect(places).toHaveLength(1);
    expect(places[0].count).toBe(2);
    expect(places[0].samples.map((sample) => sample.mediaId ?? sample.recordId)).toEqual([1, 9]);
  });

  it("drops a coordinate that is not a coordinate", () => {
    expect(
      collectPlacesFromRows([record(1, "哪里", 999, 999, 1)], []),
    ).toHaveLength(1);
    // It is kept by name; the impossible point is not put on the map.
    expect(collectPlacesFromRows([record(1, "哪里", 999, 999, 1)], [])[0].lat).toBeUndefined();
  });
});
