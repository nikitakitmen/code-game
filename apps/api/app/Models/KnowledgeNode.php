<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class KnowledgeNode extends Model
{
    public $incrementing = false; public $timestamps = false;
    protected $keyType = 'string';
    protected $fillable = ['id', 'category', 'definition_json'];
    protected $casts = ['definition_json' => 'array'];
}
