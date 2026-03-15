"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  Timestamp,
  doc,
  updateDoc,
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
  entrance_location?: string;
  ward_id?: string;
  left_school?: boolean;
}

type GradeFilter = "all" | "elementary" | "middle" | "high";

function formatTime(ts: Timestamp): string {
  const d = ts.toDate();
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDateHeading(ts: Timestamp): string {
  return ts.toDate().toLocaleDateString([], {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}

function gradeInFilter(grade: number, filter: GradeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "elementary") return grade >= 1 && grade <= 5;
  if (filter === "middle") return grade >= 6 && grade <= 8;
  if (filter === "high") return grade >= 9 && grade <= 12;
  return true;
}

export default function DashboardPage() {
  const { user, isAdmin, loading } = useAuth();
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [muted, setMuted] = useState(false);
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>("all");
  const [onlyToday, setOnlyToday] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevNoticeIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) {
      router.push("/login");
    }
  }, [user, isAdmin, loading, router]);

  useEffect(() => {
    audioRef.current = new Audio("/sounds/bell.mp3");
    audioRef.current.volume = 0.7;
  }, []);

  useEffect(() => {
    if (!user || !db) return;

    const noticesRef = collection(db, "notices");
    const q = query(noticesRef, orderBy("arrival_time", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const noticesData: Notice[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        noticesData.push({
          id: docSnap.id,
          arrival_time: data.arrival_time,
          ward_name: data.ward_name || "Unknown",
          student_grade: data.student_grade || 0,
          owner_id: data.owner_id,
          license_plate: data.licensePlate ?? data.license_plate,
          car_description: data.car_description,
          entrance_location: data.entrance_location ?? data.location,
          ward_id: data.ward_id,
          left_school: data.left_school || false,
        });
      });

      const newIds = new Set(noticesData.map((n) => n.id));
      const hasNewNotice = noticesData.some(
        (n) => !prevNoticeIdsRef.current.has(n.id),
      );
      if (prevNoticeIdsRef.current.size > 0 && hasNewNotice && !muted) {
        audioRef.current?.play().catch(() => {});
      }
      prevNoticeIdsRef.current = newIds;

      setNotices(noticesData);
    });

    return () => unsubscribe();
  }, [user, muted]);

  const filteredNotices = useMemo(() => {
    let filtered = notices;

    if (onlyToday) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayMs = todayStart.getTime();
      filtered = filtered.filter((n) => n.arrival_time.toMillis() >= todayMs);
    }

    if (gradeFilter !== "all") {
      filtered = filtered.filter((n) =>
        gradeInFilter(n.student_grade, gradeFilter),
      );
    }

    return filtered;
  }, [notices, onlyToday, gradeFilter]);

  // Group by date, dedup by student name (keep most recent per name per day)
  const groupedByDate = useMemo(() => {
    const groups: { date: string; notices: Notice[] }[] = [];
    const map = new Map<string, Notice[]>();

    for (const notice of filteredNotices) {
      const dateKey = formatDateHeading(notice.arrival_time);
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(notice);
    }

    for (const [date, dateNotices] of map) {
      // Dedup by ward_name — notices are already sorted by arrival_time desc,
      // so the first occurrence of each name is the most recent
      const seen = new Set<string>();
      const deduped = dateNotices.filter((n) => {
        const key = n.ward_name;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      groups.push({ date, notices: deduped });
    }

    return groups;
  }, [filteredNotices]);

  const handleToggleLeft = async (noticeId: string, currentStatus: boolean) => {
    if (!db) return;
    const noticeRef = doc(db, "notices", noticeId);
    await updateDoc(noticeRef, { left_school: !currentStatus });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading...</div>
      </div>
    );
  }

  const activeFilters: GradeFilter[] = ["all", "elementary", "middle", "high"];
  const filterLabels: Record<GradeFilter, string> = {
    all: "All",
    elementary: "Elementary",
    middle: "Middle",
    high: "High",
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />

      <div className="flex-1 p-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-4xl font-bold text-gray-900">Pickup Queue</h1>
          <button
            onClick={() => setMuted((m) => !m)}
            title={muted ? "Unmute arrival alerts" : "Mute arrival alerts"}
            className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 transition text-gray-600"
          >
            {muted ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold text-gray-700">Filter</span>
            <div className="flex items-center gap-3">
              {activeFilters.map((f) => (
                <label
                  key={f}
                  className="flex items-center gap-1.5 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="gradeFilter"
                    checked={gradeFilter === f}
                    onChange={() => setGradeFilter(f)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm text-gray-700">
                    {filterLabels[f]}
                  </span>
                </label>
              ))}
            </div>
            <div className="border-l border-gray-200 pl-6">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyToday}
                  onChange={(e) => setOnlyToday(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-sm text-gray-700">Only today</span>
              </label>
            </div>
          </div>
        </div>

        {/* Queue List */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {groupedByDate.length === 0 ? (
            <div className="p-12 text-center">
              <svg
                className="w-16 h-16 mx-auto text-gray-300 mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-1">
                No pickup notices
              </h3>
              <p className="text-gray-500">
                When parents arrive for pickup, notices will appear here.
              </p>
            </div>
          ) : (
            groupedByDate.map((group) => (
              <div key={group.date}>
                {/* Date Header */}
                <div className="bg-gray-100 px-6 py-3 border-b border-gray-200">
                  <h2 className="text-lg font-bold text-gray-800">
                    {group.date}
                  </h2>
                </div>

                {/* Notice Rows */}
                {group.notices.map((notice) => (
                  <div
                    key={notice.id}
                    className={`flex items-center px-6 py-3 border-b border-gray-100 hover:bg-gray-50 transition ${
                      notice.left_school ? "opacity-50" : ""
                    }`}
                  >
                    <button
                      onClick={() =>
                        handleToggleLeft(notice.id, notice.left_school || false)
                      }
                      className={`w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition-all mr-4 ${
                        notice.left_school
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-gray-300 hover:border-green-500"
                      }`}
                    >
                      {notice.left_school && (
                        <svg
                          className="w-3 h-3"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </button>
                    <span className="font-mono text-sm text-gray-500 w-24 mx-5 flex-shrink-0">
                      {formatTime(notice.arrival_time)}
                    </span>
                    <span
                      className={`font-medium text-gray-900 w-48 text-right mr-4 flex-shrink-0 ${
                        notice.left_school ? "line-through text-gray-400" : ""
                      }`}
                    >
                      {notice.ward_name}
                    </span>
                    <GradeBadge grade={notice.student_grade} />
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
