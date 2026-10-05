<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Laravel\Sanctum\HasApiTokens;

class User extends Model
{
    use HasApiTokens, HasFactory;

    protected $fillable = ['email', 'password_hash', 'locale'];
    protected $hidden = ['password_hash'];

    public function getAuthPassword(): string
    {
        return $this->password_hash;
    }

    public function profile(): HasOne
    {
        return $this->hasOne(GameProfile::class);
    }
}
