"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import Sidebar from "@/components/Sidebar";
import GradeBadge from "@/components/GradeBadge";
import Link from "next/link";

interface Guardian {
  id: string;
  name: string;
  email?: string;
  licensePlateNumbers?: string[];
  carDescriptions?: string[];
  wardIds?: string[];
}

interface Student {
  name: string;
  grade: number;
}

interface VehicleEntry {
  guardianId: string;
  guardianName: string;
  guardianEmail?: string;
  licensePlate: string;
  carDescription: string;
  linkedStudents: Student[];
}

export default function LogVehiclePage() {
  const { user, isAdmin, loading } = useAuth();
  const router = useRouter();
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [students, setStudents] = useState<Map<string, Student>>(new Map());
  const [vehicles, setVehicles] = useState<VehicleEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredVehicles, setFilteredVehicles] = useState<VehicleEntry[]>([]);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) {
      router.push("/login");
    }
  }, [user, isAdmin, loading, router]);

  // Fetch guardians from Firestore
  useEffect(() => {
    if (!user || !db) return;

    const usersRef = collection(db, "users");
    const q = query(usersRef, where("account_type", "==", "guardian"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const guardiansData: Guardian[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        guardiansData.push({
          id: doc.id,
          name: data.name || "Unknown",
          email: data.email,
          licensePlateNumbers: data.licensePlateNumbers || [],
          carDescriptions: data.carDescriptions || [],
          wardIds: data.wardIds || [],
        });
      });
      setGuardians(guardiansData);
    });

    return () => unsubscribe();
  }, [user]);

  // Fetch students from Firestore
  useEffect(() => {
    if (!user || !db) return;

    const usersRef = collection(db, "users");
    const q = query(usersRef, where("account_type", "==", "student"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const map = new Map<string, Student>();
      snapshot.forEach((doc) => {
        const data = doc.data();
        map.set(doc.id, { name: data.name || "Unknown", grade: data.grade || 0 });
      });
      setStudents(map);
    });

    return () => unsubscribe();
  }, [user]);

  // Build vehicle entries from guardians + resolved students
  useEffect(() => {
    const vehicleEntries: VehicleEntry[] = [];

    guardians.forEach((guardian) => {
      const plates = guardian.licensePlateNumbers || [];
      const descriptions = guardian.carDescriptions || [];
      const linkedStudents = (guardian.wardIds || []).map(
        (id) => students.get(id) ?? { name: `[${id}]`, grade: 0 }
      );

      plates.forEach((plate, index) => {
        vehicleEntries.push({
          guardianId: guardian.id,
          guardianName: guardian.name,
          guardianEmail: guardian.email,
          licensePlate: plate,
          carDescription: descriptions[index] || "",
          linkedStudents,
        });
      });
    });

    vehicleEntries.sort((a, b) => a.licensePlate.localeCompare(b.licensePlate));
    setVehicles(vehicleEntries);
  }, [guardians, students]);

  // Filter vehicles by search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredVehicles(vehicles);
      return;
    }

    const q = searchQuery.toLowerCase();
    const filtered = vehicles.filter(
      (v) =>
        v.licensePlate.toLowerCase().includes(q) ||
        v.guardianName.toLowerCase().includes(q) ||
        v.carDescription.toLowerCase().includes(q)
    );
    setFilteredVehicles(filtered);
  }, [vehicles, searchQuery]);

  // Guardians with no vehicles registered
  const guardiansWithNoVehicles = useMemo(
    () => guardians.filter((g) => !g.licensePlateNumbers || g.licensePlateNumbers.length === 0),
    [guardians]
  );

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
            <h1 className="text-4xl font-bold text-gray-900">Vehicle Lookup</h1>
            <p className="text-gray-600 mt-1">
              Search for vehicles by license plate, parent name, or car description
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg
                className="h-5 w-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by license plate, parent name, or car description..."
              className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
            />
          </div>
        </div>

        {/* Results */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-xl font-bold">Registered Vehicles</h2>
            <span className="text-gray-600">{filteredVehicles.length} vehicles</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                    License Plate
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                    Parent Name
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                    Car Description
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                    Linked Students
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map((vehicle, index) => (
                  <tr
                    key={`${vehicle.guardianId}-${vehicle.licensePlate}-${index}`}
                    className="border-b border-gray-200 hover:bg-gray-50"
                  >
                    <td className="px-6 py-4">
                      <span className="font-mono font-bold bg-yellow-100 px-3 py-1 rounded text-lg">
                        {vehicle.licensePlate}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{vehicle.guardianName}</div>
                      {vehicle.guardianEmail && (
                        <div className="text-sm text-gray-500">{vehicle.guardianEmail}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {vehicle.carDescription || (
                        <span className="text-gray-400 italic">No description</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        {vehicle.linkedStudents.length > 0 ? (
                          vehicle.linkedStudents.map((s, i) => (
                            <span key={i} className="flex items-center gap-1">
                              <span className="text-sm text-gray-700">{s.name}</span>
                              <GradeBadge grade={s.grade} />
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-400 text-sm italic">None linked</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/users?guardian=${vehicle.guardianId}`}
                        className="text-blue-600 hover:underline text-sm font-medium"
                      >
                        View guardian
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredVehicles.length === 0 && (
            <div className="p-12 text-center">
              {searchQuery ? (
                <>
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
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <h3 className="text-lg font-medium text-gray-900 mb-1">No results found</h3>
                  <p className="text-gray-500">
                    No vehicles match &quot;{searchQuery}&quot;. Try a different search term.
                  </p>
                </>
              ) : (
                <>
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
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                  <h3 className="text-lg font-medium text-gray-900 mb-1">No vehicles registered</h3>
                  <p className="text-gray-500">
                    When parents register their vehicles, they will appear here.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Guardians with no vehicles */}
        {guardiansWithNoVehicles.length > 0 && (
          <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h3 className="font-semibold text-yellow-800 mb-2">
              {guardiansWithNoVehicles.length} guardian{guardiansWithNoVehicles.length !== 1 ? "s" : ""} with no vehicles registered
            </h3>
            <ul className="space-y-1">
              {guardiansWithNoVehicles.map((g) => (
                <li key={g.id} className="text-sm text-yellow-700 flex items-center gap-2">
                  <span>{g.name}</span>
                  {g.email && <span className="text-yellow-500">({g.email})</span>}
                  <Link
                    href={`/admin/users?guardian=${g.id}`}
                    className="text-yellow-800 underline text-xs ml-1"
                  >
                    View
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
