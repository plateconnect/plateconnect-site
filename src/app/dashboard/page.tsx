"use client";

import { useState, useEffect } from "react";
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
  ward_id?: string;
  left_school?: boolean;
}

interface GroupedNotice {
  owner_id: string;
  license_plate?: string;
  car_description?: string;
  arrival_time: Timestamp;
  students: {
    id: string;
    ward_name: string;
    student_grade: number;
    left_school: boolean;
  }[];
  allLeft: boolean;
}

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [groupedNotices, setGroupedNotices] = useState<GroupedNotice[]>([]);

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
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        noticesData.push({
          id: docSnap.id,
          arrival_time: data.arrival_time,
          ward_name: data.ward_name || "Unknown",
          student_grade: data.student_grade || 0,
          owner_id: data.owner_id,
          license_plate: data.license_plate,
          car_description: data.car_description,
          ward_id: data.ward_id,
          left_school: data.left_school || false,
        });
      });
      setNotices(noticesData);
    });

    return () => unsubscribe();
  }, [user]);

  // Group notices by parent (owner_id) and sort by checked status
  useEffect(() => {
    const groups: { [key: string]: GroupedNotice } = {};

    notices.forEach((notice) => {
      if (!groups[notice.owner_id]) {
        groups[notice.owner_id] = {
          owner_id: notice.owner_id,
          license_plate: notice.license_plate,
          car_description: notice.car_description,
          arrival_time: notice.arrival_time,
          students: [],
          allLeft: true,
        };
      }

      groups[notice.owner_id].students.push({
        id: notice.id,
        ward_name: notice.ward_name,
        student_grade: notice.student_grade,
        left_school: notice.left_school || false,
      });

      // Update allLeft status
      if (!notice.left_school) {
        groups[notice.owner_id].allLeft = false;
      }

      // Use earliest arrival time for the group
      if (notice.arrival_time.toMillis() < groups[notice.owner_id].arrival_time.toMillis()) {
        groups[notice.owner_id].arrival_time = notice.arrival_time;
      }
    });

    // Convert to array and sort: unchecked first, then by arrival time
    const sortedGroups = Object.values(groups).sort((a, b) => {
      // Unchecked (not all left) first
      if (a.allLeft !== b.allLeft) {
        return a.allLeft ? 1 : -1;
      }
      // Then by arrival time (earliest first for unchecked, latest first for checked)
      return a.allLeft
        ? b.arrival_time.toMillis() - a.arrival_time.toMillis()
        : a.arrival_time.toMillis() - b.arrival_time.toMillis();
    });

    setGroupedNotices(sortedGroups);
  }, [notices]);

  const handleCheckGroup = async (group: GroupedNotice) => {
    const newStatus = !group.allLeft;

    // Update all students in the group
    for (const student of group.students) {
      const noticeRef = doc(db, "notices", student.id);
      await updateDoc(noticeRef, { left_school: newStatus });
    }
  };

  const handleCheckStudent = async (studentId: string, currentStatus: boolean) => {
    const noticeRef = doc(db, "notices", studentId);
    await updateDoc(noticeRef, { left_school: !currentStatus });
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
            <h1 className="text-4xl font-bold text-gray-900">Pickup Queue</h1>
            <p className="text-gray-600 mt-1">
              Check off students as they leave. Groups with unchecked students appear first.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="w-3 h-3 rounded-full bg-green-500"></span>
              <span>Elementary (1-5)</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="w-3 h-3 rounded-full bg-orange-500"></span>
              <span>Middle (6-8)</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="w-3 h-3 rounded-full bg-blue-500"></span>
              <span>High (9-12)</span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {groupedNotices.map((group) => {
            const arrivalDate = group.arrival_time.toDate();
            const timeStr = arrivalDate.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <div
                key={group.owner_id}
                className={`bg-white rounded-lg shadow overflow-hidden transition-all ${
                  group.allLeft ? "opacity-60" : ""
                }`}
              >
                <div className="p-4 flex items-center gap-4">
                  {/* Group Checkbox */}
                  <button
                    onClick={() => handleCheckGroup(group)}
                    className={`w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-all ${
                      group.allLeft
                        ? "bg-green-500 border-green-500 text-white"
                        : "border-gray-300 hover:border-green-500"
                    }`}
                    title={group.allLeft ? "Mark all as not left" : "Mark all as left"}
                  >
                    {group.allLeft && (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>

                  {/* Vehicle Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      {group.license_plate && (
                        <span className="font-mono font-bold bg-yellow-100 px-3 py-1 rounded text-lg">
                          {group.license_plate}
                        </span>
                      )}
                      {group.car_description && (
                        <span className="text-gray-600">{group.car_description}</span>
                      )}
                    </div>
                  </div>

                  {/* Arrival Time */}
                  <div className="text-right">
                    <div className="text-sm text-gray-500">Arrived</div>
                    <div className="font-medium">{timeStr}</div>
                  </div>
                </div>

                {/* Students */}
                <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                  <div className="flex flex-wrap gap-3">
                    {group.students.map((student) => (
                      <div
                        key={student.id}
                        className={`flex items-center gap-2 bg-white rounded-lg px-3 py-2 shadow-sm ${
                          student.left_school ? "opacity-60" : ""
                        }`}
                      >
                        <button
                          onClick={() => handleCheckStudent(student.id, student.left_school)}
                          className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                            student.left_school
                              ? "bg-green-500 border-green-500 text-white"
                              : "border-gray-300 hover:border-green-500"
                          }`}
                        >
                          {student.left_school && (
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </button>
                        <span
                          className={`font-medium ${
                            student.left_school ? "line-through text-gray-400" : "text-gray-900"
                          }`}
                        >
                          {student.ward_name}
                        </span>
                        <GradeBadge grade={student.student_grade} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {groupedNotices.length === 0 && (
            <div className="bg-white rounded-lg shadow p-12 text-center">
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
              <h3 className="text-lg font-medium text-gray-900 mb-1">No pickup notices</h3>
              <p className="text-gray-500">
                When parents arrive for pickup, notices will appear here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
