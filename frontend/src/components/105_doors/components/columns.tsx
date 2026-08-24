import { type ColumnDef } from "@tanstack/react-table";
import { type Door } from "../services/door.service";

export const columns: ColumnDef<Door>[] = [
  { accessorKey: "id", header: "ID" },
  { accessorKey: "name", header: "Name", enableSorting: true },
  { accessorKey: "door_code", header: "Door Code", enableSorting: true },
  { accessorKey: "mqtt_topic", header: "MQTT Topic", enableSorting: true },
  { accessorKey: "active", header: "Active", enableSorting: true },
];
