// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MB, makeFile } from "../../tests/factories";
import { FileTable, type FileRow } from "./file-table";

function rowsOf(count: number): FileRow[] {
  return Array.from({ length: count }, (_, i) => {
    const file = makeFile({ name: `Datei-${String(i).padStart(3, "0")}.zip`, size: (count - i) * MB });
    return { id: file.id, file, bytes: file.size };
  });
}

function setup(props: Partial<Parameters<typeof FileTable>[0]> = {}) {
  const rows = props.rows ?? rowsOf(60);
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <FileTable rows={rows} action="delete" {...props} />
    </TooltipProvider>,
  );
  const rowBoxes = () => screen.getAllByRole("checkbox", { name: "Zeile auswählen" });
  const bar = () => screen.queryByText(/ausgewählt ·/)?.parentElement ?? null;
  return { user, rows, rowBoxes, bar };
}

describe("FileTable", () => {
  it("shows totals and paginates 50 rows per page", async () => {
    const { user, rowBoxes } = setup();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(rowBoxes()).toHaveLength(50);
    expect(screen.getByText("Seite 1 von 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Nächste Seite" }));
    expect(rowBoxes()).toHaveLength(10);
    expect(screen.getByText("Seite 2 von 2")).toBeInTheDocument();
  });

  it("sorts by size, largest first", () => {
    setup();
    const firstRow = screen.getAllByRole("row")[1];
    expect(within(firstRow).getByText("Datei-000.zip")).toBeInTheDocument();
  });

  it("selects single rows and Shift ranges", async () => {
    const { user, rowBoxes, bar } = setup();

    await user.click(rowBoxes()[0]);
    expect(rowBoxes()[0]).toBeChecked();
    expect(bar()).toHaveTextContent("1 ausgewählt");

    await user.keyboard("{Shift>}");
    await user.click(rowBoxes()[3]);
    await user.keyboard("{/Shift}");

    expect(rowBoxes().slice(0, 4).every((b) => b.getAttribute("aria-checked") === "true")).toBe(true);
    expect(rowBoxes()[4]).not.toBeChecked();
    expect(bar()).toHaveTextContent("4 ausgewählt");
    // 60 + 59 + 58 + 57 MB
    expect(bar()).toHaveTextContent("234 MB");
  });

  it("selects the page, then offers to select every result", async () => {
    const { user, bar } = setup();
    await user.click(screen.getByRole("checkbox", { name: "Alle auf dieser Seite auswählen" }));
    expect(bar()).toHaveTextContent("50 ausgewählt");

    await user.click(screen.getByRole("button", { name: /Alle 60 Dateien auswählen/ }));
    expect(bar()).toHaveTextContent("60 ausgewählt");
  });

  it("supports quick selections and dismissing", async () => {
    const rows = rowsOf(5);
    const onDismiss = vi.fn();
    const { user, bar } = setup({ rows, onDismiss, quickSelect: [{ label: "Hohe Priorität", ids: [rows[1].id, rows[2].id] }] });

    await user.click(screen.getByRole("button", { name: /Hohe Priorität/ }));
    expect(bar()).toHaveTextContent("2 ausgewählt");

    await user.click(screen.getByRole("button", { name: /Ignorieren/ }));
    expect(onDismiss).toHaveBeenCalledWith([rows[1].id, rows[2].id]);
    expect(bar()).toBeNull();
  });

  it("opens the confirmation dialog with the selection summary", async () => {
    const { user, rowBoxes } = setup({ rows: rowsOf(3) });
    await user.click(rowBoxes()[0]);
    await user.click(screen.getByRole("button", { name: "Löschen" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("1 Datei löschen?")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "In Papierkorb verschieben" })).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    setup({ rows: [], emptyTitle: "Nichts da" });
    expect(screen.getByText("Nichts da")).toBeInTheDocument();
  });
});
