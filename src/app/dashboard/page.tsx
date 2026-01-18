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
  person_type?: string;
  entrance_location?: string;
  action_type?: string;
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
  const [selectedPersonTypes, setSelectedPersonTypes] = useState<string[]>([]);
  const [selectedEnterExit, setSelectedEnterExit] = useState<string[]>([]);
  const [entranceLocations, setEntranceLocations] = useState<string[]>(["Main Gate", "Side Entrance"]);
  const [selectedEntranceLocations, setSelectedEntranceLocations] = useState<string[]>([]);
  const [editingLocationIndex, setEditingLocationIndex] = useState<number | null>(null);
  const [editingLocationValue, setEditingLocationValue] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? "w-64" : "w-20"} text-white p-6 shadow-lg flex flex-col transition-all duration-300`} style={{ background: `linear-gradient(180deg, #004191 0%, #003070 100%)` }}>
        <div className="flex items-center justify-end mb-8">
          {sidebarOpen && <h1 className="text-2xl font-bold flex-1">PlateConnect</h1>}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 rounded transition flex-shrink-0"
            style={{ backgroundColor: "transparent" }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
        
        {/* Navigation */}
        <nav className="space-y-2 flex-1">
          <a href="/dashboard" className={`flex items-center rounded-lg transition`} style={{ padding: sidebarOpen ? "0.5rem 1rem" : "0.5rem", backgroundColor: "rgba(255,255,255,0.2)" }} title="Dashboard">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zm8-6a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1h-2a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
            {sidebarOpen && <span className="ml-3">Dashboard</span>}
          </a>
          <a href="#" className={`flex items-center rounded-lg transition`} style={{ padding: sidebarOpen ? "0.5rem 1rem" : "0.5rem" }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.2)"} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"} title="Log Vehicle">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            {sidebarOpen && <span className="ml-3">Log Vehicle</span>}
          </a>
          <a href="#" className={`flex items-center rounded-lg transition`} style={{ padding: sidebarOpen ? "0.5rem 1rem" : "0.5rem" }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.2)"} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"} title="Reports">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
            {sidebarOpen && <span className="ml-3">Reports</span>}
          </a>
          <a href="#" className={`flex items-center rounded-lg transition`} style={{ padding: sidebarOpen ? "0.5rem 1rem" : "0.5rem" }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.2)"} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"} title="Users">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM9 6a3 3 0 11-6 0 3 3 0 016 0zM9 6a3 3 0 11-6 0 3 3 0 016 0zM9 6a3 3 0 11-6 0 3 3 0 016 0zm12 1a1 1 0 100-2 1 1 0 000 2zm-1 4a1 1 0 11-2 0 1 1 0 012 0zm2-5a1 1 0 100-2 1 1 0 000 2z" />
            </svg>
            {sidebarOpen && <span className="ml-3">Users</span>}
          </a>
          <a href="#" className={`flex items-center rounded-lg transition`} style={{ padding: sidebarOpen ? "0.5rem 1rem" : "0.5rem" }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.2)"} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"} title="Locations">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
            </svg>
            {sidebarOpen && <span className="ml-3">Locations</span>}
          </a>
        </nav>

        {/* Settings and Logout */}
        <div className="space-y-2 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.2)" }}>
          <a href="#" className={`flex items-center rounded-lg transition`} style={{ padding: sidebarOpen ? "0.5rem 1rem" : "0.5rem" }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.2)"} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"} title="Settings">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zm-9.46 16.175c1.266.667 2.844.667 4.11 0 1.266-.667 2.844-.667 4.11 0 1.266.667 2.844.667 4.11 0 1.266-.667 2.844-.667 4.11 0" clipRule="evenodd" />
            </svg>
            {sidebarOpen && <span className="ml-3">Settings</span>}
          </a>
          <a href="#" className={`flex items-center rounded-lg transition`} style={{ padding: sidebarOpen ? "0.5rem 1rem" : "0.5rem" }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.2)"} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"} title="Help & Support">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            {sidebarOpen && <span className="ml-3">Help & Support</span>}
          </a>
          <button
            onClick={handleLogout}
            className={`w-full flex items-center text-white rounded-lg transition`}
            style={{ backgroundColor: "#ef4444", padding: sidebarOpen ? "0.5rem 1rem" : "0.5rem" }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#dc2626"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#ef4444"}
            title="Logout"
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm10.293 9.293a1 1 0 001.414-1.414L11.414 9.5h2.879a1 1 0 100-2h-2.879l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3z" clipRule="evenodd" />
            </svg>
            {sidebarOpen && <span className="ml-3">Logout</span>}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900">Dashboard</h1>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Filters</h2>
        {/* First Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Arrival Date Range
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex-1 px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2"
                style={{ focusColor: "#004191" }}
                onFocus={(e) => e.currentTarget.style.ringColor = "#004191"}
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="flex-1 px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2"
                onFocus={(e) => e.currentTarget.style.boxShadow = "0 0 0 3px rgba(108, 176, 241, 0.1), inset 0 0 0 1px rgba(108, 176, 241, 0.5)"}
                onBlur={(e) => e.currentTarget.style.boxShadow = ""}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Arrival Time Range
            </label>
            <div className="flex gap-2">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="flex-1 px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2"
                onFocus={(e) => e.currentTarget.style.boxShadow = "0 0 0 3px rgba(108, 176, 241, 0.1), inset 0 0 0 1px rgba(108, 176, 241, 0.5)"}
                onBlur={(e) => e.currentTarget.style.boxShadow = ""}
              />
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="flex-1 px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2"
                onFocus={(e) => e.currentTarget.style.boxShadow = "0 0 0 3px rgba(108, 176, 241, 0.1), inset 0 0 0 1px rgba(108, 176, 241, 0.5)"}
                onBlur={(e) => e.currentTarget.style.boxShadow = ""}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max notices per page
                </label>
                <input
                  type="number"
                  value={maxNotices}
                  onChange={(e) => setMaxNotices(Number(e.target.value))}
                  className="w-20 px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2"
                  min="1"
                  max="500"
                  onFocus={(e) => e.currentTarget.style.boxShadow = "0 0 0 3px rgba(108, 176, 241, 0.1), inset 0 0 0 1px rgba(108, 176, 241, 0.5)"}
                  onBlur={(e) => e.currentTarget.style.boxShadow = ""}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Enter/Exit
                </label>
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
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="block text-sm font-medium text-gray-700">Person Type</label>
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

          <div className="flex flex-col gap-2">
            <label className="block text-sm font-medium text-gray-700">Entrance Location</label>
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
                        className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2"
                        style={{ boxShadow: "none" }}
                        onFocus={(e) => e.currentTarget.style.boxShadow = "0 0 0 3px rgba(108, 176, 241, 0.1), inset 0 0 0 1px rgba(108, 176, 241, 0.5)"}
                        onBlur={(e) => e.currentTarget.style.boxShadow = ""}
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
                            setSelectedEntranceLocations(selectedEntranceLocations.filter((l) => l !== location));
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
                          setSelectedEntranceLocations(selectedEntranceLocations.filter((l) => l !== location));
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
              className="text-sm font-medium self-start"
              style={{ color: "#004191" }}
              onMouseEnter={(e) => e.currentTarget.style.color = "#003070"}
              onMouseLeave={(e) => e.currentTarget.style.color = "#004191"}
              title="Add new entrance location"
            >
              + Add Location
            </button>
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button
            onClick={() => {
              setStartDate("");
              setEndDate("");
              setStartTime("");
              setEndTime("");
              setMaxNotices(50);
              setSelectedPersonTypes([]);
              setSelectedEntranceLocations([]);
            }}
            className="px-4 py-1 text-gray-800 rounded"
            style={{ backgroundColor: "#e5e7eb" }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#d1d5db"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#e5e7eb"}
          >
            Reset Filters
          </button>
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
                  Location
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
                      <span className="px-3 py-1 rounded-full text-white text-xs font-medium" style={{ backgroundColor: "#004191" }}>
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
                      {notice.entrance_location || (
                        <span className="text-gray-400">N/A</span>
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
    </div>
  );
}
