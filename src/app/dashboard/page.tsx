"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { collection, query, orderBy, onSnapshot, Timestamp } from "firebase/firestore";

interface Notice {
  id: string;
  arrival_time: Timestamp;
  ward_name: string;
  student_grade: number;
  owner_id: string;
  license_plate?: string;
  car_description?: string;
  ward_id?: string;
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [filteredNotices, setFilteredNotices] = useState<Notice[]>([]);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [maxNotices, setMaxNotices] = useState(50);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // Fetch notices from Firestore
  useEffect(() => {
    if (!user) return;

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
          license_plate: data.license_plate,
          car_description: data.car_description,
          ward_id: data.ward_id,
        });
      });
      setNotices(noticesData);
    });

    return () => unsubscribe();
  }, [user]);

  // Filter notices
  useEffect(() => {
    let filtered = notices;

    // Filter by date
    if (startDate || endDate) {
      filtered = filtered.filter((notice) => {
        const noticeDate = notice.arrival_time.toDate();
        const noticeDateStr = noticeDate.toISOString().split("T")[0];

        if (startDate && noticeDateStr < startDate) return false;
        if (endDate && noticeDateStr > endDate) return false;
        return true;
      });
    }

    // Filter by time
    if (startTime || endTime) {
      filtered = filtered.filter((notice) => {
        const noticeDate = notice.arrival_time.toDate();
        const hours = noticeDate.getHours().toString().padStart(2, "0");
        const minutes = noticeDate.getMinutes().toString().padStart(2, "0");
        const noticeTimeStr = `${hours}:${minutes}`;

        if (startTime && noticeTimeStr < startTime) return false;
        if (endTime && noticeTimeStr > endTime) return false;
        return true;
      });
    }

    setFilteredNotices(filtered.slice(0, maxNotices));
  }, [
    notices,
    startDate,
    endDate,
    startTime,
    endTime,
    maxNotices,
  ]);

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold text-gray-900">Dashboard</h1>
        <button
          onClick={handleLogout}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Logout
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-6 mb-8">
        {/* First Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Arrival Date Range
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max notices per page
            </label>
            <input
              type="number"
              value={maxNotices}
              onChange={(e) => setMaxNotices(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="1"
              max="500"
            />
          </div>

          <div className="flex flex-col justify-end gap-2 md:col-span-2">
            <button
              onClick={() => {
                setStartDate("");
                setEndDate("");
                setStartTime("");
                setEndTime("");
                setMaxNotices(50);
              }}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
            >
              Clear Filters
            </button>
          </div>
        </div>

        {/* Second Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Arrival Time Range
            </label>
            <div className="flex gap-2">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <h2 className="text-2xl font-bold p-6 border-b border-gray-200">
          Parent Pickup Notices
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  Student Name
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  Grade
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  License Plate
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  Car Description
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  Arrival Date
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  Arrival Time
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredNotices.map((notice) => {
                const arrivalDate = notice.arrival_time.toDate();
                const dateStr = arrivalDate.toLocaleDateString();
                const timeStr = arrivalDate.toLocaleTimeString();

                return (
                  <tr
                    key={notice.id}
                    className="border-b border-gray-200 hover:bg-gray-50"
                  >
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {notice.ward_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <span className="px-3 py-1 rounded-full bg-blue-600 text-white text-xs font-medium">
                        Grade {notice.student_grade}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {notice.license_plate ? (
                        <span className="font-mono font-bold bg-yellow-100 px-2 py-1 rounded">
                          {notice.license_plate}
                        </span>
                      ) : (
                        <span className="text-gray-400">N/A</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {notice.car_description || (
                        <span className="text-gray-400">No description</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {dateStr}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {timeStr}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredNotices.length === 0 && (
          <div className="p-6 text-center text-gray-500">
            No pickup notices found matching the selected filters.
          </div>
        )}
      </div>
    </div>
  );
}
