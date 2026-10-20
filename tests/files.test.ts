/**
 * My Files like a shared drive (lib/client/files.ts): `npm run test:web`.
 *
 *   tabs      photos, documents, uploaded by me
 *   folders   a project's files, then a milestone section's; projects newest first, sections in milestone order
 *   search    file, project, slot, section or uploader
 *   assign    a document can't go in a photos slot
 *   zip       which files inside a zip are kept, and names that don't collide
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type LibFile, type Library, libraryFiles, projectFolders, sectionFolders, slotsFor, typeByName, zipEntryName } from "../lib/client/files";

const file = (id: number, over: Partial<LibFile>): LibFile => ({
  id,
  name: `file${id}.pdf`,
  category: "utility_bill",
  categoryLabel: "Utility Bill",
  section: "pre1",
  sectionLabel: "Before Milestone 1",
  projectId: 1,
  projectName: "Jalan Kayu Residence",
  contentType: "application/pdf",
  kind: "document",
  size: 1000,
  uploadedAt: `2026-10-${String(id).padStart(2, "0")}T09:00:00+08:00`,
  mine: false,
  uploader: { uid: 7, name: "Ravi Kumar", role: "epc_team", avatar: null },
  ...over,
});

const LIB: Library = {
  files: [
    file(1, {}),
    file(2, { name: "roof.jpg", kind: "photo", category: "panel_pictures", categoryLabel: "Installed Panel Pictures", section: "pre1b", sectionLabel: "Pre-end of Milestone 1", mine: true }),
    file(3, { projectId: 2, projectName: "Siglap Garden House", section: "m3", sectionLabel: "Milestone 3", category: "sp_appointment_letter", categoryLabel: "SP Appointment Letter" }),
    file(4, { projectId: 2, projectName: "Siglap Garden House", uploader: { uid: 9, name: "Priya Nair", role: "contractor", avatar: null } }),
  ],
  projects: [
    { id: 1, name: "Jalan Kayu Residence", status: "in_progress" },
    { id: 2, name: "Siglap Garden House", status: "maintenance" },
  ],
  sections: [
    { key: "pre1", label: "Before Milestone 1" },
    { key: "pre1b", label: "Pre-end of Milestone 1" },
    { key: "m1", label: "Milestone 1" },
    { key: "m3", label: "Milestone 3" },
  ],
  slots: [
    { key: "utility_bill", label: "Utility Bill", section: "pre1", kind: "file" },
    { key: "panel_pictures", label: "Installed Panel Pictures", section: "pre1b", kind: "photos" },
  ],
  unassigned: [],
};
const ids = (fs: LibFile[]) => fs.map((f) => f.id);
const ALL = { projectId: null, section: null };

describe("tabs", () => {
  it("all", () => assert.deepEqual(ids(libraryFiles(LIB, "all", ALL, "")), [1, 2, 3, 4]));
  it("photos", () => assert.deepEqual(ids(libraryFiles(LIB, "photo", ALL, "")), [2]));
  it("documents", () => assert.deepEqual(ids(libraryFiles(LIB, "document", ALL, "")), [1, 3, 4]));
  it("uploaded by me", () => assert.deepEqual(ids(libraryFiles(LIB, "mine", ALL, "")), [2]));
});

describe("folders", () => {
  it("projects, the one with the newest file first", () =>
    assert.deepEqual(projectFolders(LIB.files).map((p) => [p.name, p.count]), [
      ["Siglap Garden House", 2],
      ["Jalan Kayu Residence", 2],
    ]));
  it("a project's files", () => assert.deepEqual(ids(libraryFiles(LIB, "all", { projectId: 2, section: null }, "")), [3, 4]));
  it("its sections, in milestone order, only those with files", () =>
    assert.deepEqual(sectionFolders(libraryFiles(LIB, "all", { projectId: 1, section: null }, ""), LIB.sections).map((s) => [s.key, s.count]), [
      ["pre1", 1],
      ["pre1b", 1],
    ]));
  it("a section's files", () => assert.deepEqual(ids(libraryFiles(LIB, "all", { projectId: 2, section: "m3" }, "")), [3]));
});

describe("search", () => {
  it("by slot", () => assert.deepEqual(ids(libraryFiles(LIB, "all", ALL, "appointment")), [3]));
  it("by section", () => assert.deepEqual(ids(libraryFiles(LIB, "all", ALL, "milestone 3")), [3]));
  it("by uploader", () => assert.deepEqual(ids(libraryFiles(LIB, "all", ALL, "priya")), [4]));
  it("by project and type", () => assert.deepEqual(ids(libraryFiles(LIB, "all", ALL, "jalan photo")), [2]));
});

describe("assign", () => {
  it("a photo can go in any slot", () => assert.equal(slotsFor(LIB.slots, "photo").length, 2));
  it("a document only where documents go", () => assert.deepEqual(slotsFor(LIB.slots, "document").map((s) => s.key), ["utility_bill"]));
});

describe("zip", () => {
  it("keeps photos and PDFs", () => assert.deepEqual(["a.JPG", "b.jpeg", "c.png", "d.webp", "e.heic", "f.pdf"].map(typeByName).every(Boolean), true));
  it("leaves anything else out", () => assert.deepEqual(["notes.docx", "sheet.xlsx", "jpg", "noext", "folder/"].map(typeByName), [null, null, null, null, null]));
  it("leaves out the hidden copies a Mac adds", () => assert.deepEqual(["__MACOSX/a.jpg", "photos/._a.jpg", "photos/a.jpg"].map(typeByName), [null, null, "image/jpeg"]));
  it("numbers a repeated name, keeping its folder", () => {
    const taken = new Set<string>();
    assert.deepEqual(["Jalan/bill.pdf", "Jalan/Bill.pdf", "Jalan/bill.pdf", "Siglap/bill.pdf", "Jalan/notes"].map((n) => zipEntryName(n, taken)), ["Jalan/bill.pdf", "Jalan/Bill (2).pdf", "Jalan/bill (3).pdf", "Siglap/bill.pdf", "Jalan/notes"]);
  });
  it("makes a name safe", () => assert.equal(zipEntryName('a:b*?"<>|.pdf', new Set()), "a_b______.pdf"));
});
