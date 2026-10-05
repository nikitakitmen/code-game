<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Mission extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';
    protected $fillable = ['id', 'act', 'slug', 'order', 'title_key', 'content_version', 'definition_json', 'enabled'];
    protected $casts = ['definition_json' => 'array', 'enabled' => 'boolean'];
}
