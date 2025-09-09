"use client"

import type React from "react"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { LogOut, Settings, ArrowLeft, Menu } from "lucide-react"

interface AdminHeaderProps {
  title: string
  showBackButton?: boolean
  backUrl?: string
  rightContent?: React.ReactNode
}

export function AdminHeader({
  title,
  showBackButton = false,
  backUrl = "/admin/dashboard",
  rightContent,
}: AdminHeaderProps) {
  const router = useRouter()

  const handleLogout = () => {
    // Simulate logout
    router.push("/auth/login")
  }

  const handleBack = () => {
    router.push(backUrl)
  }

  const handleSettings = () => {
    // Navigate to admin settings page (placeholder)
    console.log("Navigate to admin settings")
  }

  return (
    <header className="bg-white shadow-sm border-b">
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {showBackButton && (
            <Button variant="ghost" size="sm" onClick={handleBack} className="p-2 hover:bg-gray-100">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        </div>

        <div className="flex items-center gap-4">
          {rightContent}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="p-2">
                <Menu className="h-6 w-6" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={handleSettings}>
                <Settings className="h-4 w-4 mr-2" />
                Pengaturan
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                <LogOut className="h-4 w-4 mr-2" />
                Keluar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
