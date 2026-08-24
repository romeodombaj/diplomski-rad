import { type ColumnDef } from "@tanstack/react-table";
import { type Building } from "../services/building.service";

export const columns: ColumnDef<Building>[] = [
  { accessorKey: "id", header: "ID" },
  { accessorKey: "name", header: "Name", enableSorting: true },
  { accessorKey: "address", header: "Address", enableSorting: true },
  { accessorKey: "contract_address", header: "Contract Address", enableSorting: true },
];
