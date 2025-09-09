"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ArrowLeft, Menu, LogOut, UserCircle, AlertCircle } from "lucide-react"

interface TechnicianHeaderProps {
  title: string
  showBackButton?: boolean
  backUrl?: string
}

export function TechnicianHeader({
  title,
  showBackButton = false,
  backUrl = "/user/dashboard",
}: TechnicianHeaderProps) {
  const router = useRouter()

  const handleLogout = () => {
    // Simulate logout
    router.push("/auth/login")
  }

  const handleBack = () => {
    router.push(backUrl)
  }

  const handleProfileClick = () => {
    router.push("/user/profile")
  }

  const handleComplaintClick = () => {
    router.push("/user/complain")
  }

  return (
    <header className="bg-white shadow-sm border-b">
      <div className="px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {showBackButton && (
            <Button variant="ghost" size="sm" onClick={handleBack} className="p-2">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="p-2">
              <Menu className="h-6 w-6" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={handleProfileClick}>
              <UserCircle className="h-4 w-4 mr-2" />
              Profil
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleComplaintClick}>
              <AlertCircle className="h-4 w-4 mr-2" />
              Ajukan Komplain
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="text-red-600">
              <LogOut className="h-4 w-4 mr-2" />
              Keluar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
