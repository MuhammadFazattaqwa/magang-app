"use client"

import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { TechnicianHeader } from "@/components/technician-header"
import { Key, LogOut, User } from "lucide-react"

export default function TechnicianProfile() {
  const router = useRouter()

  const handleResetPassword = () => {
    router.push("/user/reset-password")
  }

  const handleLogout = () => {
    // Simulate logout
    router.push("/auth/login")
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TechnicianHeader title="Profil" showBackButton={true} backUrl="/user/dashboard" />

      {/* Main Content */}
      <main className="p-4">
        <div className="max-w-md mx-auto">
          {/* Profile Photo Section */}
          <div className="flex flex-col items-center mt-6 mb-8">
            <Avatar className="h-24 w-24 mb-4">
              <AvatarFallback className="bg-gray-100 text-gray-600">
                <User className="h-12 w-12" />
              </AvatarFallback>
            </Avatar>

            {/* Technician Name */}
            <h2 className="text-lg font-bold text-gray-900">Ahmad Teknisi</h2>
          </div>

          {/* Profile Options */}
          <div className="space-y-4">
            {/* Reset Password Card */}
            <Card
              className="cursor-pointer transition-all hover:shadow-md hover:bg-gray-50"
              onClick={handleResetPassword}
            >
              <CardContent className="p-4">
                <div className="flex items-center">
                  <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-full mr-4">
                    <Key className="h-5 w-5 text-blue-600" />
                  </div>
                  <span className="text-gray-900 font-medium">Reset Password</span>
                </div>
              </CardContent>
            </Card>

            {/* Logout Card */}
            <Card className="cursor-pointer transition-all hover:shadow-md hover:bg-red-50" onClick={handleLogout}>
              <CardContent className="p-4">
                <div className="flex items-center">
                  <div className="flex items-center justify-center w-10 h-10 bg-red-100 rounded-full mr-4">
                    <LogOut className="h-5 w-5 text-red-600" />
                  </div>
                  <span className="text-red-600 font-medium">Logout</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}
