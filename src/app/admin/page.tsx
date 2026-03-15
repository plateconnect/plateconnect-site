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
import GradeBadge from "@/components/GradeBadge";

interface Notice {
  id: string;
  arrival_time: Timestamp;
  ward_name: string;
  student_grade: number;
  owner_id: string;
  license_plate?: string;
  car_description?: string;
  ward_id?: string;
  person_type?: string;
  entrance_location?: string;
  action_type?: string;
  left_school?: boolean;
}

function exportToCsv(rows: Notice[]) {
  const headers = [
    "Student",
    "Grade",
    "License Plate",
    "Car Description",
    "Location",
    "Status",
    "Date",
    "Time",
  ];
  const lines = rows.map((n) => {
    const d = n.arrival_time.toDate();
    return [
      n.ward_name,
      n.student_grade,
      n.license_plate ?? "",
      n.car_description ?? "",
      n.entrance_location ?? "",
      n.left_school ? "Left" : "Pending",
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
  a.download = `notices-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminDashboardPage() {
  const { user, isAdmin, loading } = useAuth();
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Pagination
  const PAGE_SIZE = 50;
  const [currentPage, setCurrentPage] = useState(1);

  // Filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [selectedGradeLevels, setSelectedGradeLevels] = useState<string[]>([]);
  const [showLeftSchool, setShowLeftSchool] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) {
      router.push("/login");
    }
  }, [user, isAdmin, loading, router]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!user || !db) return;

    const noticesRef = collection(db, "notices");
    const q = query(noticesRef, orderBy("arrival_time", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const noticesData: Notice[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        noticesData.push({
          id: doc.id,
          arrival_time: data.arrival_time,
          ward_name: data.ward_name || "Unknown",
          student_grade: data.student_grade || 0,
          owner_id: data.owner_id,
          license_plate: data.licensePlate ?? data.license_plate,
          car_description: data.car_description,
          ward_id: data.ward_id,
          person_type: data.person_type || "unknown",
          action_type: data.action_type || "entry",
          entrance_location: data.entrance_location ?? data.location,
          left_school: data.left_school || false,
        });
      });
      setNotices(noticesData);
      setLastSyncTime(new Date());
    });

    return () => unsubscribe();
  }, [user]);

  // Stats
  const stats = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const today = notices.filter((n) => n.arrival_time.toMillis() >= todayMs);

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekMs = weekStart.getTime();
    const thisWeek = notices.filter(
      (n) => n.arrival_time.toMillis() >= weekMs,
    );

    return {
      todayTotal: today.length,
      todayPending: today.filter((n) => !n.left_school).length,
      todayLeft: today.filter((n) => n.left_school).length,
      weekTotal: thisWeek.length,
      allTime: notices.length,
    };
  }, [notices]);

  const availableLocations = useMemo(() => {
    const locs = new Set<string>();
    notices.forEach((n) => {
      if (n.entrance_location) locs.add(n.entrance_location);
    });
    return Array.from(locs).sort();
  }, [notices]);

  const syncLabel = useMemo(() => {
    if (!lastSyncTime) return null;
    const diffSec = Math.floor(
      (now.getTime() - lastSyncTime.getTime()) / 1000,
    );
    if (diffSec < 5) return "Live";
    if (diffSec < 60) return `${diffSec}s ago`;
    return `${Math.floor(diffSec / 60)}m ago`;
  }, [lastSyncTime, now]);

  const filteredNotices = useMemo(() => {
    let filtered = notices;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (n) =>
          n.ward_name.toLowerCase().includes(q) ||
          (n.license_plate && n.license_plate.toLowerCase().includes(q)) ||
          (n.car_description && n.car_description.toLowerCase().includes(q)),
      );
    }

    if (startDate || endDate) {
      filtered = filtered.filter((notice) => {
        const noticeDateStr = notice.arrival_time
          .toDate()
          .toISOString()
          .split("T")[0];
        if (startDate && noticeDateStr < startDate) return false;
        if (endDate && noticeDateStr > endDate) return false;
        return true;
      });
    }

    if (startTime || endTime) {
      filtered = filtered.filter((notice) => {
        const d = notice.arrival_time.toDate();
        const t = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
        if (startTime && t < startTime) return false;
        if (endTime && t > endTime) return false;
        return true;
      });
    }

    if (selectedGradeLevels.length > 0) {
      filtered = filtered.filter((notice) => {
        const grade = notice.student_grade;
        if (
          selectedGradeLevels.includes("elementary") &&
          grade >= 1 &&
          grade <= 5
        )
          return true;
        if (
          selectedGradeLevels.includes("middle") &&
          grade >= 6 &&
          grade <= 8
        )
          return true;
        if (selectedGradeLevels.includes("high") && grade >= 9 && grade <= 12)
          return true;
        return false;
      });
    }

    if (selectedLocations.length > 0) {
      filtered = filtered.filter((n) =>
        selectedLocations.includes(n.entrance_location || ""),
      );
    }

    if (showLeftSchool === "left") {
      filtered = filtered.filter((n) => n.left_school);
    } else if (showLeftSchool === "pending") {
      filtered = filtered.filter((n) => !n.left_school);
    }

    return filtered;
  }, [
    notices,
    searchQuery,
    startDate,
    endDate,
    startTime,
    endTime,
    selectedGradeLevels,
    selectedLocations,
    showLeftSchool,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredNotices.length / PAGE_SIZE),
  );
  const pagedNotices = filteredNotices.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    startDate,
    endDate,
    startTime,
    endTime,
    selectedGradeLevels,
    selectedLocations,
    showLeftSchool,
  ]);

  const activeFilterCount = [
    startDate || endDate,
    startTime || endTime,
    selectedGradeLevels.length > 0,
    selectedLocations.length > 0,
    showLeftSchool !== "all",
  ].filter(Boolean).length;

  const resetFilters = () => {
    setStartDate("");
    setEndDate("");
    setStartTime("");
    setEndTime("");
    setSelectedGradeLevels([]);
    setSelectedLocations([]);
    setShowLeftSchool("all");
    setSearchQuery("");
  };

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
              <h1 className="text-2xl font-bold text-gray-900">
                Admin Dashboard
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Arrival history and analytics
              </p>
            </div>
            {syncLabel && (
              <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 px-3 py-1.5 rounded-full">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${syncLabel === "Live" ? "bg-green-500 animate-pulse" : "bg-gray-400"}`}
                />
                {syncLabel}
              </div>
            )}
          </div>
        </div>

        <div className="px-8 py-6 space-y-6">
          {/* Stats Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Today
                </span>
                <span className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                </span>
              </div>
              <div className="text-3xl font-bold text-gray-900">
                {stats.todayTotal}
              </div>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">
                  {stats.todayPending} pending
                </span>
                <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                  {stats.todayLeft} left
                </span>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                  This Week
                </span>
                <span className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-indigo-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                </span>
              </div>
              <div className="text-3xl font-bold text-gray-900">
                {stats.weekTotal}
              </div>
              <div className="text-xs text-gray-400 mt-2">arrivals</div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                  All Time
                </span>
                <span className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                    />
                  </svg>
                </span>
              </div>
              <div className="text-3xl font-bold text-gray-900">
                {stats.allTime}
              </div>
              <div className="text-xs text-gray-400 mt-2">total records</div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Pending Now
                </span>
                <span className="w-8 h-8 rounded-lg bg-yellow-50 flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-yellow-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </span>
              </div>
              <div className="text-3xl font-bold text-yellow-600">
                {stats.todayPending}
              </div>
              <div className="text-xs text-gray-400 mt-2">
                awaiting pickup
              </div>
            </div>
          </div>

          {/* Search + Filter Bar */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-4 flex items-center gap-3">
              {/* Search */}
              <div className="relative flex-1">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, plate, or car..."
                  className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Filter Toggle */}
              <button
                onClick={() => setFiltersOpen(!filtersOpen)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition ${
                  filtersOpen || activeFilterCount > 0
                    ? "bg-blue-50 border-blue-200 text-blue-700"
                    : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                  />
                </svg>
                Filters
                {activeFilterCount > 0 && (
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {/* Export */}
              <button
                onClick={() => exportToCsv(filteredNotices)}
                disabled={filteredNotices.length === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Export
              </button>
            </div>

            {/* Expandable Filters */}
            {filtersOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-gray-100">
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mt-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">
                      Date Range
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-gray-300 self-center">-</span>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">
                      Time Range
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-gray-300 self-center">-</span>
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">
                      Grade Level
                    </label>
                    <div className="flex gap-1.5">
                      {[
                        {
                          value: "elementary",
                          label: "Elem",
                          color: "green",
                        },
                        { value: "middle", label: "Mid", color: "orange" },
                        { value: "high", label: "High", color: "blue" },
                      ].map((level) => {
                        const active = selectedGradeLevels.includes(
                          level.value,
                        );
                        return (
                          <button
                            key={level.value}
                            onClick={() => {
                              if (active) {
                                setSelectedGradeLevels(
                                  selectedGradeLevels.filter(
                                    (l) => l !== level.value,
                                  ),
                                );
                              } else {
                                setSelectedGradeLevels([
                                  ...selectedGradeLevels,
                                  level.value,
                                ]);
                              }
                            }}
                            className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition ${
                              active
                                ? `bg-${level.color}-50 border-${level.color}-200 text-${level.color}-700`
                                : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                            }`}
                            style={
                              active
                                ? {
                                    backgroundColor:
                                      level.color === "green"
                                        ? "#f0fdf4"
                                        : level.color === "orange"
                                          ? "#fff7ed"
                                          : "#eff6ff",
                                    borderColor:
                                      level.color === "green"
                                        ? "#bbf7d0"
                                        : level.color === "orange"
                                          ? "#fed7aa"
                                          : "#bfdbfe",
                                    color:
                                      level.color === "green"
                                        ? "#15803d"
                                        : level.color === "orange"
                                          ? "#c2410c"
                                          : "#1d4ed8",
                                  }
                                : {}
                            }
                          >
                            {level.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">
                      Status
                    </label>
                    <div className="flex gap-1.5">
                      {[
                        { value: "all", label: "All" },
                        { value: "pending", label: "Pending" },
                        { value: "left", label: "Left" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setShowLeftSchool(opt.value)}
                          className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition ${
                            showLeftSchool === opt.value
                              ? "bg-gray-900 border-gray-900 text-white"
                              : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {availableLocations.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">
                        Location
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {availableLocations.map((loc) => {
                          const active = selectedLocations.includes(loc);
                          return (
                            <button
                              key={loc}
                              onClick={() => {
                                if (active) {
                                  setSelectedLocations(
                                    selectedLocations.filter((l) => l !== loc),
                                  );
                                } else {
                                  setSelectedLocations([
                                    ...selectedLocations,
                                    loc,
                                  ]);
                                }
                              }}
                              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition ${
                                active
                                  ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                                  : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                              }`}
                            >
                              {loc}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {activeFilterCount > 0 && (
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={resetFilters}
                      className="text-xs text-gray-500 hover:text-gray-700 transition"
                    >
                      Clear all filters
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Results Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Table Header */}
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                {filteredNotices.length} record
                {filteredNotices.length !== 1 ? "s" : ""}
                {searchQuery && ` matching "${searchQuery}"`}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Student
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Grade
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Vehicle
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Location
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Date & Time
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pagedNotices.map((notice) => {
                    const d = notice.arrival_time.toDate();
                    const dateStr = d.toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    });
                    const timeStr = d.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    });

                    return (
                      <tr
                        key={notice.id}
                        className="hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-6 py-3.5">
                          {notice.left_school ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-100">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                              Left
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700 border border-yellow-100">
                              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3.5">
                          <span className="text-sm font-medium text-gray-900">
                            {notice.ward_name}
                          </span>
                        </td>
                        <td className="px-6 py-3.5">
                          <GradeBadge grade={notice.student_grade} />
                        </td>
                        <td className="px-6 py-3.5">
                          {notice.license_plate ? (
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold bg-gray-100 px-2 py-1 rounded">
                                {notice.license_plate}
                              </span>
                              {notice.car_description && (
                                <span className="text-xs text-gray-400 truncate max-w-[120px]">
                                  {notice.car_description}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">--</span>
                          )}
                        </td>
                        <td className="px-6 py-3.5">
                          {notice.entrance_location ? (
                            <span className="text-xs text-gray-600">
                              {notice.entrance_location}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">--</span>
                          )}
                        </td>
                        <td className="px-6 py-3.5">
                          <div className="text-sm text-gray-900">
                            {dateStr}
                          </div>
                          <div className="text-xs text-gray-400">
                            {timeStr}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredNotices.length === 0 && (
              <div className="py-16 text-center">
                <svg
                  className="w-12 h-12 mx-auto text-gray-200 mb-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={1}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
                <p className="text-sm text-gray-400">
                  No records match your filters.
                </p>
                {activeFilterCount > 0 && (
                  <button
                    onClick={resetFilters}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-700"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}

            {/* Pagination */}
            {filteredNotices.length > PAGE_SIZE && (
              <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {(currentPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(currentPage * PAGE_SIZE, filteredNotices.length)} of{" "}
                  {filteredNotices.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() =>
                      setCurrentPage((p) => Math.max(1, p - 1))
                    }
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >
                    Previous
                  </button>
                  <span className="px-3 py-1.5 text-xs text-gray-500">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
