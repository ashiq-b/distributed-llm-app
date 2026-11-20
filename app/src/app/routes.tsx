import type { ComponentType } from "react";
import { MessagesSquare, Boxes, Radar, type LucideIcon } from "lucide-react";
import DevicesScreen from "@/features/devices/DevicesScreen";
import ModelsScreen from "@/features/models/ModelsScreen";
import ChatScreen from "@/features/chat/ChatScreen";

export type RouteId = "devices" | "models" | "chat";

export interface Route {
  id: RouteId;
  label: string;
  icon: LucideIcon;
  Screen: ComponentType;
}

export const routes: Route[] = [
  { id: "devices", label: "Devices", icon: Radar, Screen: DevicesScreen },
  { id: "models", label: "Models", icon: Boxes, Screen: ModelsScreen },
  { id: "chat", label: "Chat", icon: MessagesSquare, Screen: ChatScreen },
];
