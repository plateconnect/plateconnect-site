"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, onSnapshot, Timestamp } from "firebase/firestore";
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

export default function AdminDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [filteredNotices, setFilteredNotices] = useState<Notice[]>([]);

  // Filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [maxNotices, setMaxNotices] = useState(50);
  const [selectedPersonTypes, setSelectedPersonTypes] = useState<string[]>([]);
  const [selectedEnterExit, setSelectedEnterExit] = useState<string[]>([]);
  const [entranceLocations, setEntranceLocations] = useState<string[]>(["Main Gate", "Side Entrance"]);
  const [selectedEntranceLocations, setSelectedEntranceLocations] = useState<string[]>([]);
  const [editingLocationIndex, setEditingLocationIndex] = useState<number | null>(null);
  const [editingLocationValue, setEditingLocationValue] = useState("");
  const [selectedGradeLevels, setSelectedGradeLevels] = useState<string[]>([]);
  const [showLeftSchool, setShowLeftSchool] = useState<string>("all");

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
          person_type: data.person_type || "unknown",
          action_type: data.action_type || "entry",
          entrance_location: data.entrance_location,
          left_school: data.left_school || false,
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

    // Filter by person type
    if (selectedPersonTypes.length > 0) {
      filtered = filtered.filter((notice) => {
        return selectedPersonTypes.includes(notice.person_type || "unknown");
      });
    }

    // Filter by entrance location
    if (selectedEntranceLocations.length > 0) {
      filtered = filtered.filter((notice) => {
        return selectedEntranceLocations.includes(notice.entrance_location || "");
      });
    }

    // Filter by enter/exit
    if (selectedEnterExit.length > 0) {
      filtered = filtered.filter((notice) => {
        return selectedEnterExit.includes(notice.action_type || "entry");
      });
    }

    // Filter by grade level
    if (selectedGradeLevels.length > 0) {
      filtered = filtered.filter((notice) => {
        const grade = notice.student_grade;
        if (selectedGradeLevels.includes("elementary") && grade >= 1 && grade <= 5) return true;
        if (selectedGradeLevels.includes("middle") && grade >= 6 && grade <= 8) return true;
        if (selectedGradeLevels.includes("high") && grade >= 9 && grade <= 12) return true;
        return false;
      });
    }

    // Filter by left school status
    if (showLeftSchool === "left") {
      filtered = filtered.filter((notice) => notice.left_school);
    } else if (showLeftSchool === "pending") {
      filtered = filtered.filter((notice) => !notice.left_school);
    }

    setFilteredNotices(filtered.slice(0, maxNotices));
  }, [
    notices,
    startDate,
    endDate,
    startTime,
    endTime,
    maxNotices,
    selectedPersonTypes,
    selectedEnterExit,
    selectedEntranceLocations,
    selectedGradeLevels,
    showLeftSchool,
  ]);

  const resetFilters = () => {
    setStartDate("");
    setEndDate("");
    setStartTime("");
    setEndTime("");
    setMaxNotices(50);
    setSelectedPersonTypes([]);
    setSelectedEntranceLocations([]);
    setSelectedEnterExit([]);
    setSelectedGradeLevels([]);
    setShowLeftSchool("all");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />

      {/* Main Content */}
      <div className="flex-1 p-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-gray-600 mt-1">Filter and analyze all pickup notices</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Filters</h2>

          {/* First Row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date Range</label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="flex-1 px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="flex-1 px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Time Range</label>
              <div className="flex gap-2">
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="flex-1 px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="flex-1 px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Max Results</label>
              <input
                type="number"
                value={maxNotices}
                onChange={(e) => setMaxNotices(Number(e.target.value))}
                className="w-full px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="1"
                max="500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
              <select
                value={showLeftSchool}
                onChange={(e) => setShowLeftSchool(e.target.value)}
                className="w-full px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All</option>
                <option value="pending">Pending (Not Left)</option>
                <option value="left">Left School</option>
              </select>
            </div>
          </div>

          {/* Second Row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Grade Level</label>
              <div className="space-y-2 border border-gray-300 rounded-lg p-2 bg-white">
                {[
                  { value: "elementary", label: "Elementary (1-5)", color: "bg-green-500" },
                  { value: "middle", label: "Middle (6-8)", color: "bg-orange-500" },
                  { value: "high", label: "High (9-12)", color: "bg-blue-500" },
                ].map((level) => (
                  <label key={level.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedGradeLevels.includes(level.value)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedGradeLevels([...selectedGradeLevels, level.value]);
                        } else {
                          setSelectedGradeLevels(selectedGradeLevels.filter((l) => l !== level.value));
                        }
                      }}
                      className="w-4 h-4"
                    />
                    <span className={`w-3 h-3 rounded-full ${level.color}`}></span>
                    <span className="text-sm text-gray-700">{level.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Person Type</label>
              <div className="space-y-2 max-h-32 overflow-y-auto border border-gray-300 rounded-lg p-2 bg-white">
                {["parent", "student", "teacher/staff", "unknown"].map((type) => (
                  <label key={type} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPersonTypes.includes(type)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedPersonTypes([...selectedPersonTypes, type]);
                        } else {
                          setSelectedPersonTypes(selectedPersonTypes.filter((t) => t !== type));
                        }
                      }}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-gray-700 capitalize">{type}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Enter/Exit</label>
              <div className="flex gap-3 border border-gray-300 rounded-lg p-2 bg-white">
                {["entry", "exit"].map((type) => (
                  <label key={type} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedEnterExit.includes(type)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedEnterExit([...selectedEnterExit, type]);
                        } else {
                          setSelectedEnterExit(selectedEnterExit.filter((t) => t !== type));
                        }
                      }}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-gray-700 capitalize">{type}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Entrance Location</label>
              <div className="space-y-2 max-h-32 overflow-y-auto border border-gray-300 rounded-lg p-2 bg-white">
                {entranceLocations.map((location, index) => (
                  <div key={index}>
                    {editingLocationIndex === index ? (
                      <div className="flex gap-2 mb-2">
                        <input
                          type="text"
                          value={editingLocationValue}
                          onChange={(e) => setEditingLocationValue(e.target.value)}
                          onBlur={() => {
                            if (editingLocationValue.trim()) {
                              const newLocations = [...entranceLocations];
                              newLocations[index] = editingLocationValue;
                              setEntranceLocations(newLocations);
                            }
                            setEditingLocationIndex(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              if (editingLocationValue.trim()) {
                                const newLocations = [...entranceLocations];
                                newLocations[index] = editingLocationValue;
                                setEntranceLocations(newLocations);
                              }
                              setEditingLocationIndex(null);
                            }
                          }}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedEntranceLocations.includes(location)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedEntranceLocations([...selectedEntranceLocations, location]);
                            } else {
                              setSelectedEntranceLocations(
                                selectedEntranceLocations.filter((l) => l !== location)
                              );
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <span className="text-sm text-gray-700 flex-1">{location}</span>
                        <button
                          onClick={() => {
                            setEditingLocationIndex(index);
                            setEditingLocationValue(location);
                          }}
                          className="text-gray-500 hover:text-gray-700 px-1"
                          title="Edit location"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => {
                            const newLocations = entranceLocations.filter((_, i) => i !== index);
                            setEntranceLocations(newLocations);
                            setSelectedEntranceLocations(
                              selectedEntranceLocations.filter((l) => l !== location)
                            );
                          }}
                          className="text-gray-500 hover:text-red-600 px-1"
                          title="Remove location"
                        >
                          ✕
                        </button>
                      </label>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  const newLocation = `Entrance ${entranceLocations.length + 1}`;
                  setEntranceLocations([...entranceLocations, newLocation]);
                }}
                className="text-sm font-medium mt-2"
                style={{ color: "#004191" }}
              >
                + Add Location
              </button>
            </div>
          </div>

          <div className="flex justify-end mt-4">
            <button
              onClick={resetFilters}
              className="px-4 py-2 text-gray-800 rounded-lg bg-gray-200 hover:bg-gray-300 transition"
            >
              Reset Filters
            </button>
          </div>
        </div>

        {/* Results Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-2xl font-bold">Pickup Notices</h2>
            <span className="text-gray-600">{filteredNotices.length} results</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Student</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Grade</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">License Plate</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Car Description</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Location</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Date</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredNotices.map((notice) => {
                  const arrivalDate = notice.arrival_time.toDate();
                  const dateStr = arrivalDate.toLocaleDateString();
                  const timeStr = arrivalDate.toLocaleTimeString();

                  return (
                    <tr key={notice.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-6 py-4">
                        {notice.left_school ? (
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Left
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{notice.ward_name}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        <GradeBadge grade={notice.student_grade} />
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
                        {notice.car_description || <span className="text-gray-400">No description</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {notice.entrance_location || <span className="text-gray-400">N/A</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{dateStr}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{timeStr}</td>
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
    </div>
  );
}
