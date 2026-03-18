"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = async () => {
    if (!auth) return;
    await signOut(auth);
    router.push("/login");
  };

  const isActive = (path: string) => pathname === path;

  const navItems = [
    {
      href: "/dashboard",
      label: "Pickup Queue",
      icon: (
        <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
          <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
        </svg>
      ),
    },
    {
      href: "/admin",
      label: "Admin Dashboard",
      icon: (
        <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zm8-6a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1h-2a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
      ),
    },
    {
      href: "/log-vehicle",
      label: "Vehicle Lookup",
      icon: (
        <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" />
        </svg>
      ),
    },
    {
      href: "/users",
      label: "User Management",
      icon: (
        <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
        </svg>
      ),
    },

  ];

  return (
    <div
      className={`${sidebarOpen ? "w-64" : "w-20"} text-white p-6 shadow-lg flex flex-col transition-all duration-300`}
      style={{ background: `linear-gradient(180deg, #004191 0%, #003070 100%)` }}
    >
      <div className="flex items-center justify-end mb-8">
        {sidebarOpen && <h1 className="text-2xl font-bold flex-1">PlateConnect</h1>}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1 rounded transition flex-shrink-0"
          style={{ backgroundColor: "transparent" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Navigation */}
      <nav className="space-y-2 flex-1">
        {navItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="flex items-center rounded-lg transition"
            style={{
              padding: sidebarOpen ? "0.5rem 1rem" : "0.5rem",
              backgroundColor: isActive(item.href) ? "rgba(255,255,255,0.2)" : "transparent",
            }}
            onMouseEnter={(e) => {
              if (!isActive(item.href)) {
                e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.2)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive(item.href)) {
                e.currentTarget.style.backgroundColor = "transparent";
              }
            }}
            title={item.label}
          >
            {item.icon}
            {sidebarOpen && <span className="ml-3">{item.label}</span>}
          </a>
        ))}
      </nav>

      {/* Settings and Logout */}
      <div className="space-y-2 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.2)" }}>
        <button
          onClick={() => router.push("/settings")}
          className="w-full flex items-center text-white rounded-lg transition"
          style={{ backgroundColor: "rgba(255,255,255,0.08)", padding: sidebarOpen ? "0.5rem 1rem" : "0.5rem" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.15)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)")}
          title="Settings"
        >
          <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 2a1 1 0 011 1v1.22a5.002 5.002 0 013.52 3.52H16a1 1 0 110 2h-1.48A5.002 5.002 0 0111 15.78V17a1 1 0 11-2 0v-1.22a5.002 5.002 0 01-3.52-3.52H4a1 1 0 110-2h1.48A5.002 5.002 0 019 4.22V3a1 1 0 011-1zm0 4a3 3 0 100 6 3 3 0 000-6z" />
          </svg>
          {sidebarOpen && <span className="ml-3">Settings</span>}
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center text-white rounded-lg transition"
          style={{ backgroundColor: "#ef4444", padding: sidebarOpen ? "0.5rem 1rem" : "0.5rem" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#dc2626")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#ef4444")}
          title="Logout"
        >
          <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 4a1 1 0 011-1h6a1 1 0 110 2H9v10h5a1 1 0 110 2H8a1 1 0 01-1-1V4zm9.293 5.293a1 1 0 00-1.414 1.414L17.586 12H11a1 1 0 100 2h6.586l-2.707 2.707a1 1 0 001.414 1.414l4.5-4.5a1 1 0 000-1.414l-4.5-4.5z" />
          </svg>
          {sidebarOpen && <span className="ml-3">Logout</span>}
        </button>
      </div>
    </div>
  );
}
