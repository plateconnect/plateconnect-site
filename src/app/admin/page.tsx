"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import Sidebar from "@/components/Sidebar";

interface Notice {
  id: string;
  arrival_time: Timestamp;
  ward_names: string[];
  owner_id: string;
  license_plate?: string;
  image_url?: string;
  ward_ids?: string[];
  person_type?: string;
  entrance_location?: string;
  status?: string;
  departure_time?: Timestamp;
}

function groupArrivals(raw: Notice[]): Notice[] {
  const byKey = new Map<string, Notice[]>();
  const passthrough: Notice[] = [];

  for (const n of raw) {
    if (!n.license_plate) {
      passthrough.push(n);
      continue;
    }
    const day = n.arrival_time.toDate().toISOString().split("T")[0];
    const key = `${n.license_plate.toLowerCase()}_${day}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(n);
  }

  const result: Notice[] = [...passthrough];

  for (const group of byKey.values()) {
    const sorted = [...group].sort((a, b) => a.arrival_time.toMillis() - b.arrival_time.toMillis());
    const pendingArrivals: Notice[] = [];
    for (const n of sorted) {
      const status = (n.status || "").toLowerCase();
      if (status === "left" && pendingArrivals.length > 0) {
        const arrived = pendingArrivals.shift()!;
        result.push({ ...arrived, status: "left", departure_time: n.arrival_time });
      } else if (status === "arrived") {
        pendingArrivals.push(n);
      } else {
        result.push(n);
      }
    }
    result.push(...pendingArrivals);
  }

  return result.sort((a, b) => b.arrival_time.toMillis() - a.arrival_time.toMillis());
}

function formatDateShort(d: Date) {
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
}

function formatTimeShort(d: Date) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatElapsed(startMs: number, endMs: number) {
  const totalMin = Math.max(0, Math.round((endMs - startMs) / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

type ExportScope = "current-filter" | "today" | "this-week" | "all";

function statusLabel(status?: string) {
  const key = (status || "").toLowerCase();
  if (key === "arrived") return "Arrived";
  if (key === "left") return "Left";
  return "Not set";
}

function exportToCsv(rows: Notice[], scope: ExportScope) {
  const headers = ["Type", "Name", "License Plate", "Location", "Status", "Image URL", "Date", "Time"];
  const lines = rows.map((n) => {
    const d = n.arrival_time.toDate();
    return [
      n.person_type ?? "unknown",
      n.ward_names.join(", "),
      n.license_plate ?? "",
      n.entrance_location ?? "",
      statusLabel(n.status),
      n.image_url ?? "",
      d.toLocaleDateString(),
      d.toLocaleTimeString(),
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",");
  });
  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const scopeLabel = scope === "current-filter" ? "current-filter" : scope === "today" ? "today" : scope === "this-week" ? "this-week" : "all";
  a.download = `notices-${scopeLabel}-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const PERSON_TYPE_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "parent", label: "Parent" },
  { value: "guardian", label: "Guardian" },
  { value: "teacher", label: "Teacher" },
  { value: "unknown", label: "Unknown" },
];

const LOCATION_OPTIONS = [
  { value: "main entrance", label: "Main Entrance" },
  { value: "side entrance", label: "Side Entrance" },
  { value: "N/A", label: "N/A" },
];

const PERSON_TYPE_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  student:  { bg: "bg-blue-50",   text: "text-blue-700",   dot: "bg-blue-400" },
  parent:   { bg: "bg-purple-50", text: "text-purple-700", dot: "bg-purple-400" },
  guardian: { bg: "bg-purple-50", text: "text-purple-700", dot: "bg-purple-400" },
  teacher:  { bg: "bg-teal-50",   text: "text-teal-700",   dot: "bg-teal-400" },
  unknown:  { bg: "bg-gray-100",  text: "text-gray-500",   dot: "bg-gray-300" },
};

function PersonTypeBadge({ type }: { type?: string }) {
  const key = (type || "unknown").toLowerCase();
  const style = PERSON_TYPE_STYLES[key] ?? PERSON_TYPE_STYLES.unknown;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${style.bg} ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot}`} />
      {key}
    </span>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const key = (status || "").toLowerCase();
  if (key === "arrived") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700 border border-yellow-100">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />Arrived
      </span>
    );
  }
  if (key === "left") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-100">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />Left
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />Not set
    </span>
  );
}

function TimeRangeCell({ arrival, departure }: { arrival: Date; departure?: Date }) {
  const [showElapsed, setShowElapsed] = useState(false);
  const dateStr = formatDateShort(arrival);
  const startStr = formatTimeShort(arrival);

  if (!departure) {
    return <span className="text-sm text-gray-900 whitespace-nowrap">{dateStr} {startStr}</span>;
  }

  const endStr = formatTimeShort(departure);
  const elapsed = formatElapsed(arrival.getTime(), departure.getTime());

  return (
    <span className="text-sm text-gray-900 whitespace-nowrap inline-flex items-center gap-1">
      {dateStr} {startStr}
      <span className="relative inline-flex">
        <button
          type="button"
          onMouseEnter={() => setShowElapsed(true)}
          onMouseLeave={() => setShowElapsed(false)}
          onClick={() => setShowElapsed((v) => !v)}
          className="px-0.5 text-gray-400 hover:text-blue-600 transition"
        >
          -
        </button>
        {showElapsed && (
          <span className="absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {elapsed}
          </span>
        )}
      </span>
      {endStr}
    </span>
  );
}

function MultiSelectPills({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (val: string) =>
    onChange(selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val]);
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-2">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => toggle(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition select-none ${
                active
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { user, isAdmin, loading } = useAuth();
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [filtersOpen, setFiltersOpen] = useState(false);

  const PAGE_SIZE = 50;
  const [currentPage, setCurrentPage] = useState(1);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedPersonTypes, setSelectedPersonTypes] = useState<string[]>([]);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportScope, setExportScope] = useState<ExportScope>("current-filter");

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) router.push("/login");
  }, [user, isAdmin, loading, router]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const q = query(collection(db, "arrivals"), orderBy("arrival_time", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const noticesData: Notice[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        noticesData.push({
          id: doc.id,
          arrival_time: data.arrival_time,
          ward_names: data.ward_names || [],
          owner_id: data.owner_id,
          license_plate: data.licensePlate,
          image_url: data.image_url,
          ward_ids: data.ward_ids,
          person_type: data.person_type || "unknown",
          entrance_location: data.entrance_location,
          status: data.status,
        });
      });
      setNotices(noticesData);
      setLastSyncTime(new Date());
    });
    return () => unsubscribe();
  }, [user]);

  const groupedNotices = useMemo(() => groupArrivals(notices), [notices]);

  const stats = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const today = groupedNotices.filter((n) => n.arrival_time.toMillis() >= todayMs);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const thisWeek = groupedNotices.filter((n) => n.arrival_time.toMillis() >= weekStart.getTime());
    return {
      todayTotal: today.length,
      todayArrived: today.filter((n) => (n.status || "").toLowerCase() === "arrived").length,
      todayLeft: today.filter((n) => (n.status || "").toLowerCase() === "left").length,
      weekTotal: thisWeek.length,
      allTime: groupedNotices.length,
    };
  }, [groupedNotices]);

  const syncLabel = useMemo(() => {
    if (!lastSyncTime) return null;
    const diffSec = Math.floor((now.getTime() - lastSyncTime.getTime()) / 1000);
    if (diffSec < 5) return "Live";
    if (diffSec < 60) return `${diffSec}s ago`;
    return `${Math.floor(diffSec / 60)}m ago`;
  }, [lastSyncTime, now]);

  const filteredNotices = useMemo(() => {
    let filtered = groupedNotices;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (n) =>
          n.ward_names.some((name) => name.toLowerCase().includes(q)) ||
          (n.license_plate && n.license_plate.toLowerCase().includes(q))
      );
    }
    if (startDate || endDate) {
      filtered = filtered.filter((n) => {
        const d = n.arrival_time.toDate().toISOString().split("T")[0];
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
        return true;
      });
    }
    if (startTime || endTime) {
      filtered = filtered.filter((n) => {
        const d = n.arrival_time.toDate();
        const t = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
        if (startTime && t < startTime) return false;
        if (endTime && t > endTime) return false;
        return true;
      });
    }
    if (selectedPersonTypes.length > 0) {
      filtered = filtered.filter((n) =>
        selectedPersonTypes.includes((n.person_type || "unknown").toLowerCase())
      );
    }
    if (selectedLocations.length > 0) {
      filtered = filtered.filter((n) => {
        const loc = (n.entrance_location || "N/A").toLowerCase();
        return selectedLocations.some(
          (sel) => sel.toLowerCase() === loc || (sel === "N/A" && !n.entrance_location)
        );
      });
    }
    if (statusFilter === "arrived") filtered = filtered.filter((n) => (n.status || "").toLowerCase() === "arrived");
    else if (statusFilter === "left") filtered = filtered.filter((n) => (n.status || "").toLowerCase() === "left");
    else if (statusFilter === "not-set") filtered = filtered.filter((n) => !["arrived", "left"].includes((n.status || "").toLowerCase()));
    return filtered;
  }, [groupedNotices, searchQuery, startDate, endDate, startTime, endTime, selectedLocations, selectedPersonTypes, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredNotices.length / PAGE_SIZE));
  const pagedNotices = filteredNotices.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, startDate, endDate, startTime, endTime, selectedLocations, selectedPersonTypes, statusFilter]);

  const activeFilterCount = [
    startDate || endDate,
    startTime || endTime,
    selectedLocations.length > 0,
    selectedPersonTypes.length > 0,
    statusFilter !== "all",
  ].filter(Boolean).length;

  const resetFilters = () => {
    setStartDate(""); setEndDate("");
    setStartTime(""); setEndTime("");
    setSelectedLocations([]);
    setSelectedPersonTypes([]);
    setStatusFilter("all");
    setSearchQuery("");
  };

  const getExportRows = (scope: ExportScope) => {
    if (scope === "current-filter") return filteredNotices;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    if (scope === "today") {
      return groupedNotices.filter((n) => n.arrival_time.toMillis() >= todayStart.getTime());
    }

    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    if (scope === "this-week") {
      return groupedNotices.filter((n) => n.arrival_time.toMillis() >= weekStart.getTime());
    }

    return groupedNotices;
  };

  const handleExport = () => {
    exportToCsv(getExportRows(exportScope), exportScope);
    setExportModalOpen(false);
  };

  const exportOptions = [
    {
      value: "current-filter" as const,
      label: "Current filter",
      description: "Export only the records visible with your current filters.",
    },
    {
      value: "today" as const,
      label: "Today's notices",
      description: "Export all notices from today.",
    },
    {
      value: "this-week" as const,
      label: "This week",
      description: "Export notices from the current week.",
    },
    {
      value: "all" as const,
      label: "Everything",
      description: "Export every notice in the database.",
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-500">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />

      <div className="flex-1 overflow-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200">
          <div className="px-8 py-5 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
              <p className="text-sm text-gray-500 mt-0.5">Arrival history and analytics</p>
            </div>
            {syncLabel && (
              <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 px-3 py-1.5 rounded-full">
                <span className={`w-1.5 h-1.5 rounded-full ${syncLabel === "Live" ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                {syncLabel}
              </div>
            )}
          </div>
        </div>

        <div className="px-8 py-6 space-y-6">
          {/* Stats Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: "Today", value: stats.todayTotal, icon: (
                  <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                ), iconBg: "bg-blue-50",
                sub: <div className="flex items-center gap-3 mt-2"><span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">{stats.todayArrived} arrived</span><span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">{stats.todayLeft} left</span></div>,
                color: "text-gray-900",
              },
              {
                label: "This Week", value: stats.weekTotal, icon: (
                  <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                ), iconBg: "bg-indigo-50",
                sub: <div className="text-xs text-gray-400 mt-2">arrivals</div>,
                color: "text-gray-900",
              },
              {
                label: "All Time", value: stats.allTime, icon: (
                  <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" /></svg>
                ), iconBg: "bg-gray-100",
                sub: <div className="text-xs text-gray-400 mt-2">total records</div>,
                color: "text-gray-900",
              },
              {
                label: "Awaiting Pickup", value: stats.todayArrived, icon: (
                  <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                ), iconBg: "bg-yellow-50",
                sub: <div className="text-xs text-gray-400 mt-2">on campus</div>,
                color: "text-yellow-600",
              },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{s.label}</span>
                  <span className={`w-8 h-8 rounded-lg ${s.iconBg} flex items-center justify-center`}>{s.icon}</span>
                </div>
                <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
                {s.sub}
              </div>
            ))}
          </div>

          {/* Search + Filter Bar */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-3 flex items-center gap-2.5">
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by name or plate..." className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              <button
                onClick={() => setFiltersOpen(!filtersOpen)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition ${filtersOpen || activeFilterCount > 0 ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                Filters
                {activeFilterCount > 0 && <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">{activeFilterCount}</span>}
              </button>
              <button onClick={() => setExportModalOpen(true)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                Export
              </button>
            </div>

            {filtersOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-gray-100">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2">Date Range</label>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-6 shrink-0">From</span>
                        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-6 shrink-0">To</span>
                        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2">Time Range</label>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-6 shrink-0">From</span>
                        <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-6 shrink-0">To</span>
                        <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2">Status</label>
                    <div className="flex gap-1.5">
                      {[{ value: "all", label: "All" }, { value: "arrived", label: "Arrived" }, { value: "left", label: "Left" }, { value: "not-set", label: "Not set" }].map((opt) => (
                        <button key={opt.value} onClick={() => setStatusFilter(opt.value)} className={`flex-1 px-2 py-2 text-xs font-medium rounded-lg border transition ${statusFilter === opt.value ? "bg-gray-900 border-gray-900 text-white" : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{opt.label}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="border-t border-gray-100 my-4" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <MultiSelectPills label="Person Type" options={PERSON_TYPE_OPTIONS} selected={selectedPersonTypes} onChange={setSelectedPersonTypes} />
                  <MultiSelectPills label="Detection Location" options={LOCATION_OPTIONS} selected={selectedLocations} onChange={setSelectedLocations} />
                </div>
                {activeFilterCount > 0 && (
                  <div className="mt-4 flex justify-end">
                    <button onClick={resetFilters} className="text-xs text-gray-500 hover:text-gray-700 transition">Clear all filters</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Results Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Type</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Time</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">License Plate</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Name</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Location</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Image</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pagedNotices.map((notice) => {
                    const arrivalDate = notice.arrival_time.toDate();
                    const departureDate = notice.departure_time?.toDate();
                    return (
                      <tr key={notice.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-2.5">
                          <StatusBadge status={notice.status} />
                        </td>
                        <td className="px-3 py-2.5">
                          <PersonTypeBadge type={notice.person_type} />
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <TimeRangeCell arrival={arrivalDate} departure={departureDate} />
                        </td>
                        <td className="px-3 py-2.5">
                          {notice.license_plate ? (
                            <span className="font-mono text-xs font-bold bg-gray-100 px-2.5 py-1 rounded tracking-wide">
                              {notice.license_plate}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-sm font-medium text-gray-900">{notice.ward_names.join(", ")}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          {notice.entrance_location ? (
                            <span className="text-xs text-gray-600">{notice.entrance_location}</span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {notice.image_url ? (
                            <a href={notice.image_url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:text-blue-700 hover:underline">
                              View image
                            </a>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredNotices.length === 0 && (
              <div className="py-16 text-center">
                <svg className="w-12 h-12 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="text-sm text-gray-400">No records match your filters.</p>
                {activeFilterCount > 0 && (
                  <button onClick={resetFilters} className="mt-2 text-xs text-blue-600 hover:text-blue-700">Clear filters</button>
                )}
              </div>
            )}

            {filteredNotices.length > PAGE_SIZE && (
              <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredNotices.length)} of {filteredNotices.length}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition">Previous</button>
                  <span className="px-3 py-1.5 text-xs text-gray-500">{currentPage} / {totalPages}</span>
                  <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition">Next</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {exportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Export notices</h2>
              <p className="mt-1 text-sm text-gray-500">Choose what you want to export.</p>
            </div>

            <div className="space-y-2 px-5 py-4">
              {exportOptions.map((option) => {
                const checked = exportScope === option.value;
                return (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 transition ${checked ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}
                  >
                    <input
                      type="radio"
                      name="export-scope"
                      value={option.value}
                      checked={checked}
                      onChange={() => setExportScope(option.value)}
                      className="mt-0.5 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{option.label}</div>
                      <div className="mt-0.5 text-xs text-gray-500">{option.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button
                onClick={() => setExportModalOpen(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
              >
                Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
